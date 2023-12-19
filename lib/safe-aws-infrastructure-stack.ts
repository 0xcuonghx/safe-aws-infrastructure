import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";

import { Construct } from "constructs";
import { SafeClientGatewayStack } from "./safe-client-gateway-stack";
import { SafeConfigServiceStack } from "./safe-config-service-stack";

export class SafeAwsInfrastructureStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, "safe-vpc", {
      vpcName: "safe-vpc",
    });

    const logGroup = new logs.LogGroup(this, "safe-log-group", {
      logGroupName: "safe-log-group",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_MONTH,
    });

    const secrets = new secretsmanager.Secret(this, "safe-secrets", {
      secretName: "safe-secret",
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          // CGW
          CGW_EXCHANGE_API_KEY: "",
          CGW_AUTH_TOKEN: "",
          // CFG
          CFG_SECRET_KEY: "",
          CFG_DJANGO_SUPERUSER_PASSWORD: "",
          CFG_DJANGO_SUPERUSER_USERNAME: "",
          CFG_DJANGO_SUPERUSER_EMAIL: "",
        }),
        generateStringKey: "secret",
      },
    });

    const safeCgwALB = new elbv2.ApplicationLoadBalancer(this, "safe-cgw-alb", {
      vpc,
      internetFacing: true,
      loadBalancerName: "safe-cgw-alb",
    });

    const safeCfgALB = new elbv2.ApplicationLoadBalancer(this, "safe-cfg-alb", {
      vpc,
      internetFacing: true,
      loadBalancerName: "safe-cfg-alb",
    });

    const safeCGW = new SafeClientGatewayStack(this, "safe-cgw", {
      vpc,
      logGroup,
      safeCgwALB,
      safeCfgALB,
      secrets,
    });

    const safeCFG = new SafeConfigServiceStack(this, "safe-cfg", {
      vpc,
      logGroup,
      safeCgwALB,
      safeCfgALB,
      secrets,
    });
  }
}
