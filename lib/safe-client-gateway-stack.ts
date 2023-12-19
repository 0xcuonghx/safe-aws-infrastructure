import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";

import { SafeRedisStack } from "./safe-redis-stack";

interface SafeClientGatewayStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  logGroup: logs.LogGroup;
  secrets: secretsmanager.Secret;
  safeCgwALB: elbv2.ApplicationLoadBalancer;
  safeCfgALB: elbv2.ApplicationLoadBalancer;
}

export class SafeClientGatewayStack extends cdk.NestedStack {
  constructor(
    scope: Construct,
    id: string,
    props: SafeClientGatewayStackProps
  ) {
    super(scope, id, props);

    const { vpc, logGroup, secrets, safeCfgALB, safeCgwALB } = props;

    // redis
    const redis = new SafeRedisStack(this, "safe-cgw-redis", {
      vpc,
      clusterName: "safe-cgw-redis",
    });

    // web
    const cluster = new ecs.Cluster(this, "safe-cgw-cluster", {
      enableFargateCapacityProviders: true,
      vpc,
      clusterName: "safe-cgw-cluster",
    });

    const task = new ecs.FargateTaskDefinition(this, "safe-cgw-task", {
      cpu: 512,
      memoryLimitMiB: 1024,
      family: "safe-cgw-task",
    });

    const container = task.addContainer("safe-cgw-container", {
      containerName: "safe-cgw-web",
      logging: new ecs.AwsLogDriver({
        logGroup,
        streamPrefix: "safe-cgw-web",
        mode: ecs.AwsLogDriverMode.NON_BLOCKING,
      }),
      portMappings: [
        {
          containerPort: 3000,
        },
      ],
      image: ecs.ContainerImage.fromAsset("docker/safe-client-gateway"),
      environment: {
        REDIS_HOST: redis.cluster.attrRedisEndpointAddress,
        REDIS_PORT: redis.cluster.attrRedisEndpointPort,
        APPLICATION_PORT: "3000",
        SAFE_CONFIG_BASE_URI: `http://${safeCfgALB.loadBalancerDnsName}`,
      },
      secrets: {
        PRICES_PROVIDER_API_KEY: ecs.Secret.fromSecretsManager(
          secrets,
          "CGW_PRICES_PROVIDER_API_KEY"
        ),
        EXCHANGE_API_KEY: ecs.Secret.fromSecretsManager(
          secrets,
          "CGW_EXCHANGE_API_KEY"
        ),
        AUTH_TOKEN: ecs.Secret.fromSecretsManager(secrets, "CGW_AUTH_TOKEN"),
        ALERTS_PROVIDER_SIGNING_KEY: ecs.Secret.fromSecretsManager(
          secrets,
          "CGW_ALERTS_PROVIDER_SIGNING_KEY"
        ),
        ALERTS_PROVIDER_API_KEY: ecs.Secret.fromSecretsManager(
          secrets,
          "CGW_ALERTS_PROVIDER_API_KEY"
        ),
        ALERTS_PROVIDER_ACCOUNT: ecs.Secret.fromSecretsManager(
          secrets,
          "CGW_ALERTS_PROVIDER_ACCOUNT"
        ),
        ALERTS_PROVIDER_PROJECT: ecs.Secret.fromSecretsManager(
          secrets,
          "CGW_ALERTS_PROVIDER_PROJECT"
        ),
      },
    });

    const web = new ecs.FargateService(this, "safe-cgw-web", {
      cluster: cluster,
      taskDefinition: task,
      enableExecuteCommand: true,
      desiredCount: 1,
      serviceName: "safe-cgw-web",
    });

    // Setup LB and redirect traffic to web and static containers
    const listener = safeCgwALB.addListener("safe-cgw-listener", {
      port: 80,
    });

    listener.addTargets("safe-cgw-target", {
      port: 80,
      targets: [
        web.loadBalancerTarget({
          containerName: container.containerName,
        }),
      ],
      healthCheck: {
        path: "/health",
      },
    });

    [web].forEach((service) => {
      service.connections.allowTo(
        redis.connections,
        ec2.Port.tcp(6379),
        "safe-cgw-redis"
      );
    });
  }
}
