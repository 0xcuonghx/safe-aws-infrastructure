import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";

import { SafeRedisStack } from "./safe-redis-stack";
import { SafeLoadBalancerStack } from "./safe-load-balancer-stack";

interface SafeClientGatewayStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  loadBalancer: SafeLoadBalancerStack;
  logGroup: logs.LogGroup;
}

export class SafeClientGatewayStack extends cdk.NestedStack {
  constructor(
    scope: Construct,
    id: string,
    props: SafeClientGatewayStackProps
  ) {
    super(scope, id, props);

    const { vpc, loadBalancer, logGroup } = props;

    const redisCluster = new SafeRedisStack(this, "RedisCluster", {
      vpc,
      clusterName: "SafeClientGatewayRedis",
    });

    const ecsCluster = new ecs.Cluster(this, "SafeCluster", {
      enableFargateCapacityProviders: true,
      vpc,
    });

    const webTaskDefinition = new ecs.FargateTaskDefinition(
      this,
      "SafeCGWServiceWeb",
      {
        cpu: 512,
        memoryLimitMiB: 1024,
        family: "SafeServices",
      }
    );

    const secrets = new secretsmanager.Secret(this, "SafeSecrets");

    webTaskDefinition.addContainer("Web", {
      containerName: "web",
      workingDirectory: "/app",
      logging: new ecs.AwsLogDriver({
        logGroup,
        streamPrefix: "Web",
        mode: ecs.AwsLogDriverMode.NON_BLOCKING,
      }),
      portMappings: [
        {
          containerPort: 3666,
        },
      ],
      image: ecs.ContainerImage.fromAsset("docker/safe-client-gateway"),
      environment: {
        SAFE_CONFIG_BASE_URI: `http://${loadBalancer.safeCfgServiceLoadBalancer.loadBalancerDnsName}`,
        REDIS_HOST: redisCluster.cluster.attrRedisEndpointAddress,
        REDIS_PORT: redisCluster.cluster.attrRedisEndpointPort,
        LOG_LEVEL: "info",
      },
      secrets: {
        EXCHANGE_API_KEY: ecs.Secret.fromSecretsManager(
          secrets,
          "CGW_EXCHANGE_API_KEY"
        ),
        AUTH_TOKEN: ecs.Secret.fromSecretsManager(secrets, "CGW_AUTH_TOKEN"),
      },
    });

    const service = new ecs.FargateService(this, "WebService", {
      cluster: ecsCluster,
      taskDefinition: webTaskDefinition,
      enableExecuteCommand: true,
    });

    // Setup LB and redirect traffic to web and static containers
    const listener = loadBalancer.safeCgwLoadBalancer.addListener("Listener", {
      port: 80,
    });

    listener.addTargets("WebTarget", {
      port: 80,
      targets: [
        service.loadBalancerTarget({
          containerName: "web",
        }),
      ],
    });

    service.connections.allowTo(
      redisCluster.connections,
      ec2.Port.tcp(6379),
      "Redis"
    );
  }
}
