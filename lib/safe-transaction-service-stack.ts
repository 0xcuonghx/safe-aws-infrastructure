import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";

import { Construct } from "constructs";
import { SafeDatabaseStack } from "./safe-database-stack";
import { SafeRedisStack } from "./safe-redis-stack";

interface SafeTransactionServiceStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  logGroup: logs.LogGroup;
  secrets: secretsmanager.Secret;
}

export class SafeTransactionServiceStack extends cdk.Stack {
  constructor(
    scope: Construct,
    id: string,
    props: SafeTransactionServiceStackProps
  ) {
    super(scope, id, props);

    const { vpc, logGroup, secrets } = props;

    const redis = new SafeRedisStack(this, "safe-txs-redis", {
      vpc,
      clusterName: "safe-txs-redis",
    });

    const { database } = new SafeDatabaseStack(this, "safe-txs-database", {
      vpc,
      instanceIdentifier: "safe-txs-database",
    });

    // const ecsCluster = new ecs.Cluster(this, "safe-txs-cluster", {
    //   enableFargateCapacityProviders: true,
    //   vpc,
    //   clusterName: "safe-txs-cluster",
    // });

    // // Web

    // const task = new ecs.FargateTaskDefinition(
    //   this,
    //   "safe-txs-task-definition",
    //   {
    //     cpu: 512,
    //     memoryLimitMiB: 1024,
    //     family: "safe-txs-task-definition",
    //     volumes: [{ name: "nginx-shared" }],
    //   }
    // );

    // const webContainer = task.addContainer("safe-txs-web", {
    //   containerName: "safe-txs-web",
    //   workingDirectory: "/app",
    //   command: ["docker/web/run_web.sh"],
    //   logging: new ecs.AwsLogDriver({
    //     logGroup,
    //     streamPrefix: "safe-txs-web",
    //     mode: ecs.AwsLogDriverMode.NON_BLOCKING,
    //   }),
    //   portMappings: [
    //     {
    //       containerPort: 8888,
    //     },
    //   ],
    //   image: ecs.ContainerImage.fromAsset("docker/safe-transaction-service"),
    //   environment: {
    //     PYTHONPATH: "/app/",
    //     DJANGO_SETTINGS_MODULE: "config.settings.production",
    //     DEBUG: "0",
    //     // DATABASE_URL: `psql://postgres:postgres@txs-db:5432/postgres`,
    //     ETH_L2_NETWORK: "1",
    //     REDIS_URL: `redis://${redis.cluster.attrConfigurationEndpointAddress}:${redis.cluster.attrConfigurationEndpointPort}`,
    //     // CELERY_BROKER_URL: amqp://guest:guest@txs-rabbitmq/
    //     DJANGO_ALLOWED_HOSTS: "*",
    //     FORCE_SCRIPT_NAME: "/txs/",
    //     // CSRF_TRUSTED_ORIGINS="http://localhost:8000"
    //     // EVENTS_QUEUE_URL=amqp://general-rabbitmq:5672
    //     EVENTS_QUEUE_ASYNC_CONNECTION: "True",
    //     EVENTS_QUEUE_EXCHANGE_NAME: "safe-transaction-service-events",
    //   },
    //   secrets: {
    //     DJANGO_SECRET_KEY: ecs.Secret.fromSecretsManager(
    //       secrets,
    //       "TXS_DJANGO_SECRET_KEY"
    //     ),
    //   },
    // });

    // webContainer.addMountPoints({
    //   sourceVolume: "nginx-shared",
    //   containerPath: "/app/staticfiles",
    //   readOnly: false,
    // });

    // const nginxContainer = task.addContainer("safe-txs-static-files", {
    //   containerName: "safe-txs-staticfiles",
    //   image: ecs.ContainerImage.fromRegistry("nginx:latest"),
    //   portMappings: [
    //     {
    //       containerPort: 80,
    //     },
    //   ],
    // });

    // nginxContainer.addMountPoints({
    //   sourceVolume: "nginx-shared",
    //   containerPath: "/usr/share/nginx/html/static",
    //   readOnly: true,
    // });

    // const web = new ecs.FargateService(this, "safe-txs-web", {
    //   cluster: ecsCluster,
    //   taskDefinition: task,
    //   desiredCount: 1,
    //   enableExecuteCommand: true,
    // });

    // // Worker
    // const workerTaskDefinition = new ecs.FargateTaskDefinition(
    //   this,
    //   "SafeTransactionServiceWorker",
    //   {
    //     cpu: 512,
    //     memoryLimitMiB: 1024,
    //     family: "SafeServices",
    //   }
    // );

    // workerTaskDefinition.addContainer("Worker", {
    //   containerName: "worker",
    //   command: ["docker/web/celery/worker/run.sh"],
    //   logging: new ecs.AwsLogDriver({
    //     logGroup,
    //     streamPrefix: "SafeTransactionServiceWorker",
    //     mode: ecs.AwsLogDriverMode.NON_BLOCKING,
    //   }),
    //   image: ecs.ContainerImage.fromAsset("docker/safe-transaction-service"),
    //   environment: {},
    //   secrets: {},
    // });

    // const workerService = new ecs.FargateService(this, "WorkerService", {
    //   cluster: ecsCluster,
    //   taskDefinition: workerTaskDefinition,
    //   desiredCount: 1,
    // });

    // // Scheduled Tasks
    // const scheduleTaskDefinition = new ecs.FargateTaskDefinition(
    //   this,
    //   "SafeTransactionServiceSchedule",
    //   {
    //     cpu: 512,
    //     memoryLimitMiB: 1024,
    //     family: "SafeServices",
    //   }
    // );

    // scheduleTaskDefinition.addContainer("Schedule", {
    //   containerName: "schedule",
    //   command: ["docker/web/celery/scheduler/run.sh"],
    //   logging: new ecs.AwsLogDriver({
    //     logGroup,
    //     streamPrefix: "SafeTransactionServiceScheduler",
    //     mode: ecs.AwsLogDriverMode.NON_BLOCKING,
    //   }),
    //   image: ecs.ContainerImage.fromAsset("docker/safe-transaction-service"),
    //   environment: {},
    //   secrets: {},
    // });

    // const scheduleService = new ecs.FargateService(this, "ScheduleService", {
    //   cluster: ecsCluster,
    //   taskDefinition: scheduleTaskDefinition,
    //   desiredCount: 1,
    // });

    // // Setup LB and redirect traffic to web and static containers
    // const listener =
    //   loadBalancer.safeTransactionServiceLoadBalancer.addListener("Listener", {
    //     port: 80,
    //   });

    // listener.addTargets("Static", {
    //   port: 80,
    //   targets: [
    //     webService.loadBalancerTarget({
    //       containerName: "static",
    //     }),
    //   ],
    //   priority: 1,
    //   conditions: [elbv2.ListenerCondition.pathPatterns(["/static/*"])],
    //   healthCheck: {
    //     path: "/static/drf-yasg/style.css",
    //   },
    // });

    // listener.addTargets("WebTarget", {
    //   port: 80,
    //   targets: [
    //     webService.loadBalancerTarget({
    //       containerName: "web",
    //     }),
    //   ],
    // });

    // [webService, webService, scheduleService].forEach((service) => {
    //   service.connections.allowTo(database, ec2.Port.tcp(5432), "RDS");
    //   service.connections.allowTo(
    //     redisCluster.connections,
    //     ec2.Port.tcp(6379),
    //     "Redis"
    //   );
    // });
  }
}
