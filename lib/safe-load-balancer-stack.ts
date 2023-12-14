import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";

import { Construct } from "constructs";

interface SafeLoadBalancerStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
}

export class SafeLoadBalancerStack extends cdk.NestedStack {
  private _safeCfgServiceLoadBalancer: elbv2.ApplicationLoadBalancer;
  private _safeCgwServiceLoadBalancer: elbv2.ApplicationLoadBalancer;
  private _safeTransactionServiceLoadBalancer: elbv2.ApplicationLoadBalancer;

  constructor(scope: Construct, id: string, props: SafeLoadBalancerStackProps) {
    super(scope, id, props);
    const { vpc } = props;

    // Config Service ALB
    const safeCfgServiceLoadBalancer = new elbv2.ApplicationLoadBalancer(
      this,
      "SafeCfgServiceALB",
      {
        vpc,
        internetFacing: true,
        loadBalancerName: "SafeCfgServiceALB",
      }
    );

    // Client Gateway ALB
    const safeCgwServiceLoadBalancer = new elbv2.ApplicationLoadBalancer(
      this,
      "SafeCgwServiceALB",
      {
        vpc,
        internetFacing: true,
        loadBalancerName: "SafeCgwServiceALB",
      }
    );

    // Transaction Service ALB
    const safeTransactionServiceLoadBalancer =
      new elbv2.ApplicationLoadBalancer(this, "safeTransactionServiceALB", {
        vpc,
        internetFacing: true,
        loadBalancerName: "safeTransactionServiceALB",
      });

    this._safeCfgServiceLoadBalancer = safeCfgServiceLoadBalancer;
    this._safeCgwServiceLoadBalancer = safeCgwServiceLoadBalancer;
    this._safeTransactionServiceLoadBalancer =
      safeTransactionServiceLoadBalancer;
  }

  public get safeCfgServiceLoadBalancer(): elbv2.ApplicationLoadBalancer {
    return this._safeCfgServiceLoadBalancer;
  }

  public get safeCgwServiceLoadBalancer(): elbv2.ApplicationLoadBalancer {
    return this._safeCgwServiceLoadBalancer;
  }

  public get safeTransactionServiceLoadBalancer(): elbv2.ApplicationLoadBalancer {
    return this._safeTransactionServiceLoadBalancer;
  }
}
