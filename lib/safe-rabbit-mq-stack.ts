import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as amazonmq from "aws-cdk-lib/aws-amazonmq";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";

interface SafeRabbitMQStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  brokerName: string;
}

export class SafeRabbitMQStack extends cdk.NestedStack {
  private _connections: ec2.Connections;
  private _cluster: amazonmq.CfnBroker;
  private _secret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: SafeRabbitMQStackProps) {
    super(scope, id, props);

    const { vpc, brokerName } = props;

    const rabbitMQSecurityGroup = new ec2.SecurityGroup(
      this,
      "safe-rabbit-mq-sg",
      {
        vpc,
        allowAllOutbound: true,
        description: "security group for rabbitMQ",
        securityGroupName: "safe-rabbit-mq-sg",
      }
    );

    this._connections = new ec2.Connections({
      securityGroups: [rabbitMQSecurityGroup],
      defaultPort: ec2.Port.tcp(5671),
    });

    const secrets = new secretsmanager.Secret(this, "safe-rabbit-mq-secrets", {
      secretName: `${brokerName}-credentials`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          username: "admin",
        }),
        generateStringKey: "password",
        excludeCharacters: "%+~`#$&*()|[]{}=:, ;<>?!'/@",
      },
    });

    const rabbitMQ = new amazonmq.CfnBroker(this, "safe-rabbit-mq", {
      brokerName,
      autoMinorVersionUpgrade: true,
      deploymentMode: "SINGLE_INSTANCE",
      engineType: "RABBITMQ",
      engineVersion: "3.11.20",
      hostInstanceType: "mq.t3.micro",
      logs: {
        general: true,
      },
      publiclyAccessible: false,
      securityGroups: [rabbitMQSecurityGroup.securityGroupId],
      subnetIds: [vpc.privateSubnets[0].subnetId],
      users: [
        {
          username: secrets.secretValueFromJson("username").unsafeUnwrap(),
          password: secrets.secretValueFromJson("password").unsafeUnwrap(),
        },
      ],
    });

    this._cluster = rabbitMQ;
    this._secret = secrets;
  }

  public get connections(): ec2.Connections {
    return this._connections;
  }

  public get cluster(): amazonmq.CfnBroker {
    return this._cluster;
  }

  public get uri(): string {
    const username = this._secret
      .secretValueFromJson("username")
      .unsafeUnwrap();
    const password = this._secret
      .secretValueFromJson("password")
      .unsafeUnwrap();

    const endpoint = this._cluster.attrAmqpEndpoints[0];
    const host = endpoint.match(/\/\/([^:]+):/)?.[1];
    const port = endpoint.match(/:(\d+)$/)?.[1];

    return `amqp://${username}:${password}@${host}:${port}/`;
  }
}
