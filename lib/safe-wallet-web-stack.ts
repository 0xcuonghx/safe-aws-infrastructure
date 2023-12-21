import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as logs from "aws-cdk-lib/aws-logs";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";

interface SafeWalletWebStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  logGroup: logs.LogGroup;
  safeCgwALB: elbv2.ApplicationLoadBalancer;
  safeUiALB: elbv2.ApplicationLoadBalancer;
}

export class SafeWalletWebStack extends cdk.NestedStack {
  constructor(scope: Construct, id: string, props: SafeWalletWebStackProps) {
    super(scope, id, props);

    const { vpc, logGroup, safeCgwALB, safeUiALB } = props;

    const cluster = new ecs.Cluster(this, "safe-ui-cluster", {
      enableFargateCapacityProviders: true,
      vpc,
      clusterName: "safe-ui-cluster",
    });

    const task = new ecs.FargateTaskDefinition(this, "safe-ui-task", {
      cpu: 512,
      memoryLimitMiB: 1024,
      family: "safe-ui-task",
    });

    const container = task.addContainer("safe-ui-container", {
      containerName: "safe-ui-web",
      logging: new ecs.AwsLogDriver({
        logGroup,
        streamPrefix: "safe-ui-web",
        mode: ecs.AwsLogDriverMode.NON_BLOCKING,
      }),
      portMappings: [
        {
          containerPort: 8080,
        },
      ],
      image: ecs.ContainerImage.fromAsset("docker/safe-wallet-web"),
      environment: {
        NEXT_PUBLIC_INFURA_TOKEN: "",
        NEXT_PUBLIC_GATEWAY_URL_PRODUCTION: `http://${safeCgwALB.loadBalancerDnsName}`,
        NEXT_PUBLIC_SAFE_APPS_INFURA_TOKEN: "",
        NEXT_PUBLIC_TENDERLY_SIMULATE_ENDPOINT_URL: "",
        NEXT_PUBLIC_TENDERLY_PROJECT_NAME: "",
        NEXT_PUBLIC_TENDERLY_ORG_NAME: "",
        NEXT_PUBLIC_IS_PRODUCTION: "true",
        NEXT_PUBLIC_SAFE_VERSION: "1.3.0",
        NEXT_PUBLIC_SENTRY_DSN: "",
        NEXT_PUBLIC_BEAMER_ID: "",
        NEXT_PUBLIC_WC_BRIDGE: "",
        NEXT_PUBLIC_FORTMATIC_KEY: "",
        NEXT_PUBLIC_PORTIS_KEY: "",
        NEXT_PUBLIC_CYPRESS_MNEMONIC: "",
      },
    });

    const web = new ecs.FargateService(this, "safe-ui-web", {
      cluster: cluster,
      taskDefinition: task,
      enableExecuteCommand: true,
      desiredCount: 1,
      serviceName: "safe-ui-web",
    });

    // Setup LB and redirect traffic to web and static containers
    const listener = safeUiALB.addListener("safe-ui-listener", {
      port: 80,
    });

    listener.addTargets("safe-ui-target", {
      port: 80,
      targets: [
        web.loadBalancerTarget({
          containerName: container.containerName,
        }),
      ],
      targetGroupName: "safe-ui-target",
      healthCheck: {
        path: "/",
      },
    });
  }
}
