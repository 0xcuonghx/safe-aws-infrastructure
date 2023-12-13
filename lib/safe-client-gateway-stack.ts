import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";

import { RedisStack } from "./redis-stack";

interface SafeClientGatewayStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
}

export class SafeClientGatewayStack extends cdk.NestedStack {
  constructor(
    scope: Construct,
    id: string,
    props: SafeClientGatewayStackProps
  ) {
    super(scope, id, props);

    const { vpc } = props;

    const redisCluster = new RedisStack(this, "RedisCluster", {
      vpc,
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
        logGroup: new logs.LogGroup(this, "LogGroup"),
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
        REDIS_HOST: redisCluster.cluster.attrRedisEndpointAddress,
        REDIS_PORT: redisCluster.cluster.attrRedisEndpointPort,
        LOG_LEVEL: "info",
      },
      secrets: {
        SAFE_CONFIG_BASE_URI: ecs.Secret.fromSecretsManager(
          secrets,
          "SAFE_CONFIG_BASE_URI"
        ),
        EXCHANGE_API_BASE_URI: ecs.Secret.fromSecretsManager(
          secrets,
          "EXCHANGE_API_BASE_URI"
        ),
        EXCHANGE_API_KEY: ecs.Secret.fromSecretsManager(
          secrets,
          "EXCHANGE_API_KEY"
        ),
        AUTH_TOKEN: ecs.Secret.fromSecretsManager(secrets, "AUTH_TOKEN"),
      },
    });

    const service = new ecs.FargateService(this, "WebService", {
      cluster: ecsCluster,
      taskDefinition: webTaskDefinition,
      enableExecuteCommand: true,
    });

    // Setup LB and redirect traffic to web and static containers
    const clientGatewayLoadBalancer = new elbv2.ApplicationLoadBalancer(
      this,
      "ClientGatewayApplicationLoadBalancer",
      {
        vpc,
        internetFacing: true,
      }
    );
    cdk.Tags.of(clientGatewayLoadBalancer).add("Name", "Safe Client Gateway");

    const listener = clientGatewayLoadBalancer.addListener("Listener", {
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
