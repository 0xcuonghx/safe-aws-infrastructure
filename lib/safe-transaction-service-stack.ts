import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";

import { Construct } from "constructs";
import { SafeDatabaseStack } from "./safe-database-stack";
import { SafeLoadBalancerStack } from "./safe-load-balancer-stack";
import { SafeRedisStack } from "./safe-redis-stack";

interface SafeTransactionServiceStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  loadBalancer: SafeLoadBalancerStack;
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

    const { vpc, logGroup, loadBalancer } = props;

    const redisCluster = new SafeRedisStack(
      this,
      "safeTransactionServiceRedis",
      {
        vpc,
        clusterName: "safeTransactionServiceRedis",
      }
    );

    const { database } = new SafeDatabaseStack(
      this,
      "SafeTransactionServiceDatabase",
      {
        vpc,
        instanceIdentifier: "SafeTransactionServiceDatabase",
      }
    );

    const ecsCluster = new ecs.Cluster(this, "SafeTransactionServiceCluster", {
      enableFargateCapacityProviders: true,
      vpc,
    });

    // Web

    const webTaskDefinition = new ecs.FargateTaskDefinition(
      this,
      "SafeTransactionServiceWeb",
      {
        cpu: 512,
        memoryLimitMiB: 1024,
        family: "SafeServices",
        volumes: [{ name: "nginx_volume" }],
      }
    );

    const webContainer = webTaskDefinition.addContainer("Web", {
      containerName: "web",
      workingDirectory: "/app",
      command: ["docker/web/run_web.sh"],
      logging: new ecs.AwsLogDriver({
        logGroup,
        streamPrefix: "SafeTransactionServiceWeb",
        mode: ecs.AwsLogDriverMode.NON_BLOCKING,
      }),
      portMappings: [
        {
          containerPort: 8888,
        },
      ],
      image: ecs.ContainerImage.fromAsset("docker/safe-transaction-service"),
      environment: {},
      secrets: {},
    });

    webContainer.addMountPoints({
      sourceVolume: "nginx_volume",
      containerPath: "/app/staticfiles",
      readOnly: false,
    });

    const nginxContainer = webTaskDefinition.addContainer("StaticFiles", {
      containerName: "static",
      image: ecs.ContainerImage.fromRegistry("nginx:latest"),
      portMappings: [
        {
          containerPort: 80,
        },
      ],
    });

    nginxContainer.addMountPoints({
      sourceVolume: "nginx_volume",
      containerPath: "/usr/share/nginx/html/static",
      readOnly: true,
    });

    const webService = new ecs.FargateService(this, "WebService", {
      cluster: ecsCluster,
      taskDefinition: webTaskDefinition,
      desiredCount: 1,
      enableExecuteCommand: true,
    });

    // Worker
    const workerTaskDefinition = new ecs.FargateTaskDefinition(
      this,
      "SafeTransactionServiceWorker",
      {
        cpu: 512,
        memoryLimitMiB: 1024,
        family: "SafeServices",
      }
    );

    workerTaskDefinition.addContainer("Worker", {
      containerName: "worker",
      command: ["docker/web/celery/worker/run.sh"],
      logging: new ecs.AwsLogDriver({
        logGroup,
        streamPrefix: "SafeTransactionServiceWorker",
        mode: ecs.AwsLogDriverMode.NON_BLOCKING,
      }),
      image: ecs.ContainerImage.fromAsset("docker/safe-transaction-service"),
      environment: {},
      secrets: {},
    });

    const workerService = new ecs.FargateService(this, "WorkerService", {
      cluster: ecsCluster,
      taskDefinition: workerTaskDefinition,
      desiredCount: 1,
    });

    // Scheduled Tasks
    const scheduleTaskDefinition = new ecs.FargateTaskDefinition(
      this,
      "SafeTransactionServiceSchedule",
      {
        cpu: 512,
        memoryLimitMiB: 1024,
        family: "SafeServices",
      }
    );

    scheduleTaskDefinition.addContainer("Schedule", {
      containerName: "schedule",
      command: ["docker/web/celery/scheduler/run.sh"],
      logging: new ecs.AwsLogDriver({
        logGroup,
        streamPrefix: "SafeTransactionServiceScheduler",
        mode: ecs.AwsLogDriverMode.NON_BLOCKING,
      }),
      image: ecs.ContainerImage.fromAsset("docker/safe-transaction-service"),
      environment: {},
      secrets: {},
    });

    const scheduleService = new ecs.FargateService(this, "ScheduleService", {
      cluster: ecsCluster,
      taskDefinition: scheduleTaskDefinition,
      desiredCount: 1,
    });

    // Setup LB and redirect traffic to web and static containers
    const listener =
      loadBalancer.safeTransactionServiceLoadBalancer.addListener("Listener", {
        port: 80,
      });

    listener.addTargets("Static", {
      port: 80,
      targets: [
        webService.loadBalancerTarget({
          containerName: "static",
        }),
      ],
      priority: 1,
      conditions: [elbv2.ListenerCondition.pathPatterns(["/static/*"])],
      healthCheck: {
        path: "/static/drf-yasg/style.css",
      },
    });

    listener.addTargets("WebTarget", {
      port: 80,
      targets: [
        webService.loadBalancerTarget({
          containerName: "web",
        }),
      ],
    });

    [webService, webService, scheduleService].forEach((service) => {
      service.connections.allowTo(database, ec2.Port.tcp(5432), "RDS");
      service.connections.allowTo(
        redisCluster.connections,
        ec2.Port.tcp(6379),
        "Redis"
      );
    });
  }
}
