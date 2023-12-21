import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as elasticache from "aws-cdk-lib/aws-elasticache";

interface SafeRedisProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  clusterName?: string;
}

export class SafeRedis extends Construct {
  private _connections: ec2.Connections;
  private _cluster: elasticache.CfnCacheCluster;

  constructor(scope: Construct, id: string, props: SafeRedisProps) {
    super(scope, id);

    const { vpc, clusterName } = props;

    const sg = new ec2.SecurityGroup(this, "safe-redis-sg", {
      vpc,
      allowAllOutbound: true,
      description: "security group for redis",
      securityGroupName: "safe-redis-sg",
    });

    cdk.Tags.of(sg).add("Name", "redis-server");

    sg.addIngressRule(sg, ec2.Port.allTcp(), "default-redis-server");

    this._connections = new ec2.Connections({
      securityGroups: [sg],
      defaultPort: ec2.Port.tcp(6379),
    });

    const subnetGroup = new elasticache.CfnSubnetGroup(
      this,
      "safe-redis-subnet-group",
      {
        description: "subnet group for safe redis",
        subnetIds: vpc
          .selectSubnets({
            subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          })
          .subnetIds.concat(
            vpc.selectSubnets({
              subnetType: ec2.SubnetType.PUBLIC,
            }).subnetIds
          ),
      }
    );

    const cluster = new elasticache.CfnCacheCluster(
      this,
      "safe-redis-cluster",
      {
        autoMinorVersionUpgrade: true,
        cacheNodeType: "cache.t3.small",
        engine: "redis",
        numCacheNodes: 1,
        cacheSubnetGroupName: subnetGroup.ref,
        vpcSecurityGroupIds: [sg.securityGroupId],
        clusterName,
      }
    );

    cluster.addDependency(subnetGroup);

    this._cluster = cluster;
  }

  public get connections(): ec2.Connections {
    return this._connections;
  }

  public get cluster(): elasticache.CfnCacheCluster {
    return this._cluster;
  }
}
