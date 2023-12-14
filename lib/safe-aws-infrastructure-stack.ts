import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";

import { Construct } from "constructs";
import { SafeClientGatewayStack } from "./safe-client-gateway-stack";
import { SafeLoadBalancerStack } from "./safe-load-balancer-stack";

export class SafeAwsInfrastructureStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, "SafeVPC");
    const logGroup = new logs.LogGroup(this, "LogGroup");
    const secrets = new secretsmanager.Secret(this, "SafeSecrets");

    const safeLoadBalancer = new SafeLoadBalancerStack(this, "SafeALB", {
      vpc,
    });

    const safeCGW = new SafeClientGatewayStack(this, "SafeCGW", {
      vpc,
      loadBalancer: safeLoadBalancer,
      logGroup,
      secrets,
    });
  }
}
