import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as elasticache from "aws-cdk-lib/aws-elasticache";

interface RedisStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  clusterName?: string;
}

export class SafeRedisStack extends cdk.NestedStack {
  private _connections: ec2.Connections;
  private _cluster: elasticache.CfnCacheCluster;

  constructor(scope: Construct, id: string, props: RedisStackProps) {
    super(scope, id, props);

    const { vpc, clusterName } = props;

    const redisSecurityGroup = new ec2.SecurityGroup(this, "safe-redis-sg", {
      vpc,
      allowAllOutbound: true,
      description: "security group for redis",
      securityGroupName: "safe-redis-sg",
    });

    cdk.Tags.of(redisSecurityGroup).add("Name", "redis-server");

    redisSecurityGroup.addIngressRule(
      redisSecurityGroup,
      ec2.Port.allTcp(),
      "default-redis-server"
    );

    this._connections = new ec2.Connections({
      securityGroups: [redisSecurityGroup],
      defaultPort: ec2.Port.tcp(6379),
    });

    const redisSubnetGroup = new elasticache.CfnSubnetGroup(
      this,
      "RedisSubnetGroup",
      {
        description: "subnet group for redis",
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

    const redisCluster = new elasticache.CfnCacheCluster(this, "RedisCluster", {
      autoMinorVersionUpgrade: true,
      cacheNodeType: "cache.t3.small",
      engine: "redis",
      numCacheNodes: 1,
      cacheSubnetGroupName: redisSubnetGroup.ref,
      vpcSecurityGroupIds: [redisSecurityGroup.securityGroupId],
      clusterName,
    });

    redisCluster.addDependency(redisSubnetGroup);
    this._cluster = redisCluster;
  }

  public get connections(): ec2.Connections {
    return this._connections;
  }

  public get cluster(): elasticache.CfnCacheCluster {
    return this._cluster;
  }
}
