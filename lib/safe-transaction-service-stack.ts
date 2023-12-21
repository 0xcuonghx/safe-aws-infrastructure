import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";

import { Construct } from "constructs";
import { SafeRabbitMq } from "./constructs/safe-rabbitmq";
import { SafePostgres } from "./constructs/safe-postgres";
import { SafeRedis } from "./constructs/safe-redis";

interface SafeTransactionServiceStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  logGroup: logs.LogGroup;
  safeTxsALB: elbv2.ApplicationLoadBalancer;
}

export class SafeTransactionServiceStack extends cdk.NestedStack {
  constructor(
    scope: Construct,
    id: string,
    props: SafeTransactionServiceStackProps
  ) {
    super(scope, id, props);

    const { vpc, logGroup, safeTxsALB } = props;

    const broker = new SafeRabbitMq(this, "safe-txs-rabbitmq", {
      vpc,
      brokerName: "safe-txs-rabbitmq",
    });

    const redis = new SafeRedis(this, "safe-txs-redis", {
      vpc,
      clusterName: "safe-txs-redis",
    });

    const database = new SafePostgres(this, "safe-txs-database", {
      vpc,
      instanceIdentifier: "safe-txs-database",
    });

    const ecsCluster = new ecs.Cluster(this, "safe-txs-cluster", {
      enableFargateCapacityProviders: true,
      vpc,
      clusterName: "safe-txs-cluster",
    });

    const task = new ecs.FargateTaskDefinition(
      this,
      "safe-txs-task-definition",
      {
        cpu: 512,
        memoryLimitMiB: 1024,
        family: "safe-txs",
        volumes: [{ name: "nginx-shared" }],
      }
    );

    const safeTxsSecretKey = new secretsmanager.Secret(
      this,
      "safe-rabbit-mq-secrets",
      {
        secretName: `safe-txs-secret-key`,
        generateSecretString: {
          secretStringTemplate: JSON.stringify({}),
          generateStringKey: "TXS_DJANGO_SECRET_KEY",
        },
      }
    );

    const environment = {
      PYTHONPATH: "/app/",
      DJANGO_SETTINGS_MODULE: "config.settings.production",
      DEBUG: "0",
      DATABASE_URL: database.uri,
      ETHEREUM_NODE_URL: "https://rpc-1.japanopenchain.org:8545",
      ETH_L2_NETWORK: "1",
      REDIS_URL: `redis://${redis.cluster.attrRedisEndpointAddress}:${redis.cluster.attrRedisEndpointPort}`,
      CELERY_BROKER_URL: broker.uri,
      DJANGO_ALLOWED_HOSTS: "*",
      FORCE_SCRIPT_NAME: "/txs/",
      CSRF_TRUSTED_ORIGINS: `http://${safeTxsALB.loadBalancerDnsName}`,
      // EVENTS_QUEUE_URL=amqp://general-rabbitmq:5672
      EVENTS_QUEUE_ASYNC_CONNECTION: "True",
      EVENTS_QUEUE_EXCHANGE_NAME: "safe-transaction-service-events",
    };

    const webContainer = task.addContainer("safe-txs-web", {
      containerName: "safe-txs-web",
      workingDirectory: "/app",
      command: ["docker/web/run_web.sh"],
      logging: new ecs.AwsLogDriver({
        logGroup,
        streamPrefix: "safe-txs-web",
        mode: ecs.AwsLogDriverMode.NON_BLOCKING,
      }),
      portMappings: [
        {
          containerPort: 8888,
        },
      ],
      image: ecs.ContainerImage.fromAsset("docker/safe-transaction-service"),
      environment,
      secrets: {
        DJANGO_SECRET_KEY: ecs.Secret.fromSecretsManager(
          safeTxsSecretKey,
          "TXS_DJANGO_SECRET_KEY"
        ),
      },
    });

    webContainer.addMountPoints({
      sourceVolume: "nginx-shared",
      containerPath: "/app/staticfiles",
      readOnly: false,
    });

    const nginxContainer = task.addContainer("safe-txs-static-files", {
      containerName: "safe-txs-staticfiles",
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

    const web = new ecs.FargateService(this, "safe-txs-web", {
      cluster: ecsCluster,
      taskDefinition: task,
      desiredCount: 1,
      enableExecuteCommand: true,
      serviceName: "safe-txs-web",
    });

    // Worker
    const workerTaskDefinition = new ecs.FargateTaskDefinition(
      this,
      "safe-txs-worker-task-definition",
      {
        cpu: 512,
        memoryLimitMiB: 1024,
        family: "safe-txs",
      }
    );

    workerTaskDefinition.addContainer("txs-worker-indexer", {
      containerName: "txs-worker-indexer",
      command: ["docker/web/celery/worker/run.sh"],
      logging: new ecs.AwsLogDriver({
        logGroup,
        streamPrefix: "safe-txs-worker-indexer",
        mode: ecs.AwsLogDriverMode.NON_BLOCKING,
      }),
      image: ecs.ContainerImage.fromAsset("docker/safe-transaction-service"),
      environment: {
        ...environment,
        RUN_MIGRATIONS: "1",
        WORKER_QUEUES: "default,indexing",
      },
      secrets: {
        DJANGO_SECRET_KEY: ecs.Secret.fromSecretsManager(
          safeTxsSecretKey,
          "TXS_DJANGO_SECRET_KEY"
        ),
      },
    });

    workerTaskDefinition.addContainer("txs-worker-contracts-tokens", {
      containerName: "txs-worker-contracts-tokens",
      command: ["docker/web/celery/worker/run.sh"],
      logging: new ecs.AwsLogDriver({
        logGroup,
        streamPrefix: "safe-worker-contracts-tokens",
        mode: ecs.AwsLogDriverMode.NON_BLOCKING,
      }),
      image: ecs.ContainerImage.fromAsset("docker/safe-transaction-service"),
      environment: {
        ...environment,
        WORKER_QUEUES: "contracts,tokens",
      },
      secrets: {
        DJANGO_SECRET_KEY: ecs.Secret.fromSecretsManager(
          safeTxsSecretKey,
          "TXS_DJANGO_SECRET_KEY"
        ),
      },
    });

    workerTaskDefinition.addContainer("txs-worker-notifications-webhooks", {
      containerName: "txs-worker-notifications-webhooks",
      command: ["docker/web/celery/worker/run.sh"],
      logging: new ecs.AwsLogDriver({
        logGroup,
        streamPrefix: "safe-worker-notifications-webhooks",
        mode: ecs.AwsLogDriverMode.NON_BLOCKING,
      }),
      image: ecs.ContainerImage.fromAsset("docker/safe-transaction-service"),
      environment: {
        ...environment,
        WORKER_QUEUES: "notifications,webhooks",
      },
      secrets: {
        DJANGO_SECRET_KEY: ecs.Secret.fromSecretsManager(
          safeTxsSecretKey,
          "TXS_DJANGO_SECRET_KEY"
        ),
      },
    });

    const workerService = new ecs.FargateService(
      this,
      "safe-tsx-worker-service",
      {
        cluster: ecsCluster,
        taskDefinition: workerTaskDefinition,
        desiredCount: 2,
        serviceName: "safe-tsx-worker-service",
      }
    );

    // Scheduled Tasks
    const scheduleTaskDefinition = new ecs.FargateTaskDefinition(
      this,
      "safe-txs-schedule-task-definition",
      {
        cpu: 512,
        memoryLimitMiB: 1024,
        family: "safe-txs",
      }
    );

    scheduleTaskDefinition.addContainer("safe-txs-schedule-container", {
      containerName: "safe-txs-schedule",
      command: ["docker/web/celery/scheduler/run.sh"],
      logging: new ecs.AwsLogDriver({
        logGroup,
        streamPrefix: "safe-txs-schedule",
        mode: ecs.AwsLogDriverMode.NON_BLOCKING,
      }),
      image: ecs.ContainerImage.fromAsset("docker/safe-transaction-service"),
      environment,
      secrets: {
        DJANGO_SECRET_KEY: ecs.Secret.fromSecretsManager(
          safeTxsSecretKey,
          "TXS_DJANGO_SECRET_KEY"
        ),
      },
    });

    const scheduleService = new ecs.FargateService(
      this,
      "safe-txs-schedule-service",
      {
        cluster: ecsCluster,
        taskDefinition: scheduleTaskDefinition,
        desiredCount: 1,
        serviceName: "safe-txs-schedule-service",
      }
    );

    // Setup LB and redirect traffic to web and static containers
    const listener = safeTxsALB.addListener("Listener", {
      port: 80,
    });

    listener.addTargets("safe-txs-staticfiles-target", {
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
      targetGroupName: "safe-txs-staticfiles-target",
    });

    listener.addTargets("safe-txs-web-target", {
      port: 80,
      targets: [
        web.loadBalancerTarget({ containerName: webContainer.containerName }),
      ],
      targetGroupName: "safe-txs-web-target",
    });

    [web, workerService, scheduleService].forEach((service) => {
      service.connections.allowTo(database.cluster, ec2.Port.tcp(5432));
      service.connections.allowTo(redis.connections, ec2.Port.tcp(6379));
      service.connections.allowTo(broker.connections, ec2.Port.tcp(5671));
    });
  }
}
