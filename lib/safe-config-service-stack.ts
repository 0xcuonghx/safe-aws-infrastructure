import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";

import { Construct } from "constructs";
import { SafePostgres } from "./constructs/safe-postgres";

interface SafeConfigServiceStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  safeCgwALB: elbv2.ApplicationLoadBalancer;
  safeCfgALB: elbv2.ApplicationLoadBalancer;
  logGroup: logs.LogGroup;
  cgwSecrets: secretsmanager.Secret;
}

export class SafeConfigServiceStack extends cdk.NestedStack {
  constructor(
    scope: Construct,
    id: string,
    props: SafeConfigServiceStackProps
  ) {
    super(scope, id, props);

    const { vpc, logGroup, safeCfgALB, safeCgwALB, cgwSecrets } = props;

    const secrets = new secretsmanager.Secret(this, "safe-secrets", {
      secretName: "safe-cfg-secret",
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          CFG_DJANGO_SUPERUSER_PASSWORD: "admin",
          CFG_DJANGO_SUPERUSER_USERNAME: "root",
          CFG_DJANGO_SUPERUSER_EMAIL: "test@example.com",
        }),
        generateStringKey: "CFG_SECRET_KEY",
      },
    });

    const database = new SafePostgres(this, "safe-cfg-database", {
      vpc,
      instanceIdentifier: "safe-cfg-database",
    });

    // Web
    const cluster = new ecs.Cluster(this, "safe-cfg-cluster", {
      enableFargateCapacityProviders: true,
      vpc,
      clusterName: "safe-cfg-cluster",
    });

    const task = new ecs.FargateTaskDefinition(
      this,
      "safe-cfg-task-definition",
      {
        cpu: 512,
        memoryLimitMiB: 1024,
        family: "safe-cfg-task-definition",
        volumes: [{ name: "nginx-shared" }],
      }
    );

    const webContainer = task.addContainer("safe-cfg-web", {
      containerName: "safe-cfg-web",
      logging: new ecs.AwsLogDriver({
        logGroup,
        streamPrefix: "safe-cfg-web",
        mode: ecs.AwsLogDriverMode.NON_BLOCKING,
      }),
      portMappings: [
        {
          containerPort: 8001,
        },
      ],
      image: ecs.ContainerImage.fromAsset("docker/safe-config-service"),
      environment: {
        PYTHONDONTWRITEBYTECODE: "true",
        DEBUG: "true",
        ROOT_LOG_LEVEL: "DEBUG",
        DJANGO_ALLOWED_HOSTS: "*",
        GUNICORN_BIND_PORT: "8001",
        DOCKER_NGINX_VOLUME_ROOT: "/nginx",
        GUNICORN_BIND_SOCKET: "unix:/nginx/gunicorn.socket",
        NGINX_ENVSUBST_OUTPUT_DIR: "/etc/nginx/",
        POSTGRES_NAME: "postgres",
        DOCKER_WEB_VOLUME: ".:/app",
        GUNICORN_WEB_RELOAD: "false",
        DEFAULT_FILE_STORAGE: "django.core.files.storage.FileSystemStorage",
        DJANGO_OTP_ADMIN: "false",
        CGW_URL: `http://${safeCgwALB.loadBalancerDnsName}`,
        CSRF_TRUSTED_ORIGINS: `http://${safeCfgALB.loadBalancerDnsName}`,
      },
      secrets: {
        SECRET_KEY: ecs.Secret.fromSecretsManager(secrets, "CFG_SECRET_KEY"),
        CGW_FLUSH_TOKEN: ecs.Secret.fromSecretsManager(
          cgwSecrets,
          "CGW_AUTH_TOKEN"
        ),
        DJANGO_SUPERUSER_PASSWORD: ecs.Secret.fromSecretsManager(
          secrets,
          "CFG_DJANGO_SUPERUSER_PASSWORD"
        ),
        DJANGO_SUPERUSER_USERNAME: ecs.Secret.fromSecretsManager(
          secrets,
          "CFG_DJANGO_SUPERUSER_USERNAME"
        ),
        DJANGO_SUPERUSER_EMAIL: ecs.Secret.fromSecretsManager(
          secrets,
          "CFG_DJANGO_SUPERUSER_EMAIL"
        ),
        POSTGRES_USER: ecs.Secret.fromSecretsManager(
          database.cluster.secret as secretsmanager.ISecret,
          "username"
        ),
        POSTGRES_PASSWORD: ecs.Secret.fromSecretsManager(
          database.cluster.secret as secretsmanager.ISecret,
          "password"
        ),
        POSTGRES_HOST: ecs.Secret.fromSecretsManager(
          database.cluster.secret as secretsmanager.ISecret,
          "host"
        ),
        POSTGRES_PORT: ecs.Secret.fromSecretsManager(
          database.cluster.secret as secretsmanager.ISecret,
          "port"
        ),
      },
    });

    webContainer.addMountPoints({
      sourceVolume: "nginx-shared",
      containerPath: "/app/staticfiles",
      readOnly: false,
    });

    const nginxContainer = task.addContainer("safe-cfg-staticfiles", {
      containerName: "safe-cfg-staticfiles",
      image: ecs.ContainerImage.fromRegistry("nginx:latest"),
      portMappings: [
        {
          containerPort: 80,
        },
      ],
    });

    nginxContainer.addMountPoints({
      sourceVolume: "nginx-shared",
      containerPath: "/usr/share/nginx/html/static",
      readOnly: true,
    });

    const web = new ecs.FargateService(this, "safe-cfg-web", {
      cluster,
      taskDefinition: task,
      desiredCount: 1,
      enableExecuteCommand: true,
      serviceName: "safe-cfg-web",
    });

    // Setup LB and redirect traffic to web and static containers
    const listener = safeCfgALB.addListener("safe-listener", {
      port: 80,
    });

    listener.addTargets("safe-cfg-staticfiles-target", {
      port: 80,
      targets: [
        web.loadBalancerTarget({
          containerName: nginxContainer.containerName,
        }),
      ],
      priority: 1,
      conditions: [elbv2.ListenerCondition.pathPatterns(["/static/*"])],
      healthCheck: {
        path: "/static/drf-yasg/style.css",
      },
      targetGroupName: "safe-cfg-staticfiles-target",
    });

    listener.addTargets("safe-cfg-web-target", {
      port: 80,
      targets: [
        web.loadBalancerTarget({ containerName: webContainer.containerName }),
      ],
      targetGroupName: "safe-cfg-web-target",
    });

    [web].forEach((service) => {
      service.connections.allowTo(
        database.cluster,
        ec2.Port.tcp(5432),
        "safe-cfg-database"
      );
    });
  }
}
