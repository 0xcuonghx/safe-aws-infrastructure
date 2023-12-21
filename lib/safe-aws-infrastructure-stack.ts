import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";

import { Construct } from "constructs";
import { SafeClientGatewayStack } from "./safe-client-gateway-stack";
import { SafeConfigServiceStack } from "./safe-config-service-stack";
import { SafeTransactionServiceStack } from "./safe-transaction-service-stack";
import { SafeRabbitMQStack } from "./safe-rabbit-mq-stack";
import { SafeWalletWebStack } from "./safe-wallet-web-stack";

export class SafeAwsInfrastructureStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // vpc
    const vpc = new ec2.Vpc(this, "safe-vpc", {
      vpcName: "safe-vpc",
    });

    // log
    const logGroup = new logs.LogGroup(this, "safe-log", {
      logGroupName: "safe-log",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_MONTH,
    });

    // secrets
    const cgwSecrets = new secretsmanager.Secret(this, "safe-secrets", {
      secretName: "safe-cgw-secret",
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          CGW_EXCHANGE_API_KEY: "",
        }),
        generateStringKey: "CGW_AUTH_TOKEN",
      },
    });

    // application load balancers
    const safeTxsALB = new elbv2.ApplicationLoadBalancer(this, "safe-txs-alb", {
      vpc,
      internetFacing: true,
      loadBalancerName: "safe-txs-alb",
    });

    const safeCgwALB = new elbv2.ApplicationLoadBalancer(this, "safe-cgw-alb", {
      vpc,
      internetFacing: true,
      loadBalancerName: "safe-cgw-alb",
    });

    // const safeCfgALB = new elbv2.ApplicationLoadBalancer(this, "safe-cfg-alb", {
    //   vpc,
    //   internetFacing: true,
    //   loadBalancerName: "safe-cfg-alb",
    // });

    const safeUiALB = new elbv2.ApplicationLoadBalancer(this, "safe-ui-alb", {
      vpc,
      internetFacing: true,
      loadBalancerName: "safe-ui-alb",
    });

    // new SafeClientGatewayStack(this, "safe-cgw", {
    //   vpc,
    //   logGroup,
    //   safeCgwALB,
    //   safeCfgALB,
    //   secrets: safeCgwSecrets,
    // });

    // const safeCfg = new SafeConfigServiceStack(this, "safe-cfg", {
    //   vpc,
    //   logGroup,
    //   safeCgwALB,
    //   safeCfgALB,
    //   cgwSecrets,
    // });

    new SafeTransactionServiceStack(this, "safe-txs", {
      vpc,
      logGroup,
      safeTxsALB,
    });

    new SafeWalletWebStack(this, "safe-ui", {
      vpc,
      logGroup,
      safeCgwALB,
      safeUiALB,
    });
  }
}
