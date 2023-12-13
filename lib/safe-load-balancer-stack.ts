import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";

import { Construct } from "constructs";

interface SafeLoadBalancerStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
}

export class SafeLoadBalancerStack extends cdk.NestedStack {
  private _safeCfgServiceLoadBalancer: elbv2.ApplicationLoadBalancer;
  private _safeCgwLoadBalancer: elbv2.ApplicationLoadBalancer;

  constructor(scope: Construct, id: string, props: SafeLoadBalancerStackProps) {
    super(scope, id, props);
    const { vpc } = props;

    // Config Service ALB
    const safeCfgServiceLoadBalancer = new elbv2.ApplicationLoadBalancer(
      this,
      "SafeCfgServiceLoadBalancer",
      {
        vpc,
        internetFacing: true,
      }
    );
    cdk.Tags.of(safeCfgServiceLoadBalancer).add("Name", "Safe Config Service");

    // Client Gateway ALB
    const safeCgwLoadBalancer = new elbv2.ApplicationLoadBalancer(
      this,
      "ClientGatewayApplicationLoadBalancer",
      {
        vpc,
        internetFacing: true,
      }
    );
    cdk.Tags.of(safeCgwLoadBalancer).add("Name", "Safe Client Gateway");

    this._safeCfgServiceLoadBalancer = safeCfgServiceLoadBalancer;
    this._safeCgwLoadBalancer = safeCgwLoadBalancer;
  }

  public get safeCfgServiceLoadBalancer(): elbv2.ApplicationLoadBalancer {
    return this._safeCfgServiceLoadBalancer;
  }

  public get safeCgwLoadBalancer(): elbv2.ApplicationLoadBalancer {
    return this._safeCgwLoadBalancer;
  }
}
