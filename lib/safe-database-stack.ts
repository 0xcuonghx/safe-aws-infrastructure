import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";

import { Construct } from "constructs";

interface SafeDatabaseStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  instanceIdentifier?: string;
}

export class SafeDatabaseStack extends cdk.NestedStack {
  private _database: rds.DatabaseInstance;

  constructor(scope: Construct, id: string, props: SafeDatabaseStackProps) {
    super(scope, id, props);
    const { vpc, instanceIdentifier } = props;

    const database = new rds.DatabaseInstance(this, "SafeDatabase", {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_15_4,
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MICRO
      ),
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      credentials: rds.Credentials.fromGeneratedSecret("postgres"),
      instanceIdentifier,
      storageType: rds.StorageType.GP2,
      databaseName: "postgres",
    });

    this._database = database;
  }

  public get database(): rds.DatabaseInstance {
    return this._database;
  }
}
