import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";

import { Construct } from "constructs";
import { SafeDatabaseStack } from "./safe-database-stack";
import { SafeLoadBalancerStack } from "./safe-load-balancer-stack";

interface SafeConfigServiceStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  loadBalancer: SafeLoadBalancerStack;
  logGroup: logs.LogGroup;
  secrets: secretsmanager.Secret;
}

export class SafeConfigServiceStack extends cdk.Stack {
  constructor(
    scope: Construct,
    id: string,
    props: SafeConfigServiceStackProps
  ) {
    super(scope, id, props);

    const { vpc, logGroup, secrets, loadBalancer } = props;

    const { database } = new SafeDatabaseStack(this, "CfgServiceDatabase", {
      vpc,
      instanceIdentifier: "CfgServiceDatabase",
    });

    const ecsCluster = new ecs.Cluster(this, "SafeCluster", {
      enableFargateCapacityProviders: true,
      vpc,
    });

    // Web
    const webTaskDefinition = new ecs.FargateTaskDefinition(
      this,
      "SafeCfgServiceWeb",
      {
        cpu: 512,
        memoryLimitMiB: 1024,
        family: "SafeServices",
      }
    );

    const webContainer = webTaskDefinition.addContainer("Web", {
      containerName: "web",
      logging: new ecs.AwsLogDriver({
        logGroup,
        streamPrefix: "Web",
        mode: ecs.AwsLogDriverMode.NON_BLOCKING,
      }),
      portMappings: [
        {
          containerPort: 8001,
        },
      ],
      image: ecs.ContainerImage.fromAsset("docker/safe-config-service"),
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
      readOnly: false,
    });

    const webService = new ecs.FargateService(this, "WebService", {
      cluster: ecsCluster,
      taskDefinition: webTaskDefinition,
      desiredCount: 1,
      enableExecuteCommand: true,
    });

    // Setup LB and redirect traffic to web and static containers
    const listener = loadBalancer.safeCfgServiceLoadBalancer.addListener(
      "Listener",
      {
        port: 80,
      }
    );

    listener.addTargets("Static", {
      port: 80,
      targets: [webService.loadBalancerTarget({ containerName: "static" })],
      priority: 1,
      conditions: [elbv2.ListenerCondition.pathPatterns(["/static/*"])],
      healthCheck: {
        path: "/static/drf-yasg/style.css",
      },
    });

    listener.addTargets("WebTarget", {
      port: 80,
      targets: [webService.loadBalancerTarget({ containerName: "web" })],
    });

    webService.connections.allowTo(database, ec2.Port.tcp(5432), "RDS");
  }
}
