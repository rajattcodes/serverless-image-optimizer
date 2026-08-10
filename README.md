# Serverless Image Optimizer

[![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![AWS Lambda](https://img.shields.io/badge/AWS-Lambda-FF9900?logo=awslambda&logoColor=white)](https://aws.amazon.com/lambda/)
[![AWS S3](https://img.shields.io/badge/AWS-S3-569A31?logo=amazons3&logoColor=white)](https://aws.amazon.com/s3/)

An event-driven AWS Lambda service that automatically produces web-ready images whenever files land in S3.

## Problem Statement & Solution

High-resolution source images increase storage, bandwidth costs, and page-load times. Serverless Image Optimizer listens for new objects in a source S3 bucket, then uses **Sharp** to orient images correctly, constrain them to a maximum width of **1920px**, and emit compressed **WebP** files at **80% quality** into a separate destination bucket. The two-bucket design prevents recursive S3 triggers and keeps original assets untouched.

## Architecture Workflow

```text
1. Upload image to source S3 bucket
             |
2. S3 ObjectCreated event invokes Lambda
             |
3. Lambda resizes and converts image with Sharp
             |
4. Optimized .webp file is written to destination S3 bucket
```

## Tech Stack

| Component | Purpose |
| --- | --- |
| Node.js 20 | Lambda runtime |
| AWS Lambda | Serverless image processing |
| Amazon S3 | Source event trigger and optimized asset storage |
| Sharp | Image rotation, resizing, and WebP encoding |
| AWS SDK for JavaScript v3 | S3 object reads and writes |
| IAM | Least-privilege access and logging permissions |

## Repository Contents

| File | Description |
| --- | --- |
| `index.js` | Lambda handler and S3 image pipeline |
| `package.json` | Production dependencies and scripts |
| `iam-policy.json` | Execution-role permissions template |
| `template.yaml` | AWS SAM infrastructure definition |
| `tests/index.test.js` | Jest unit tests for the handler and transformation chain |
| `events/s3-put-event.json` | S3 `ObjectCreated:Put` test event |

## Testing

Run the unit test suite locally after installing dependencies:

```bash
npm install
npm test
```

The tests mock S3 and Sharp, so they run without AWS credentials or native image tooling. They verify S3 key decoding, the EXIF-orientation transform, the `1920px` resize limit, WebP conversion at quality `80`, destination write details, and invalid event rejection.

## Deployment Instructions

### 1. Create two S3 buckets

Create a source bucket for original images and a distinct destination bucket for optimized images. Keeping these separate avoids the destination write event reinvoking the function.

### 2. Configure the IAM execution role

Create a Lambda execution role and attach the policy in [`iam-policy.json`](iam-policy.json). Replace these placeholders before attaching it:

- `SOURCE_BUCKET_NAME`
- `DESTINATION_BUCKET_NAME`
- `AWS_REGION`
- `AWS_ACCOUNT_ID`
- `SERVERLESS_IMAGE_OPTIMIZER_FUNCTION`

If either bucket uses a customer-managed KMS key, also grant the Lambda role the minimum required KMS permissions for the relevant key (`kms:Decrypt` for source reads and `kms:Encrypt`/`kms:GenerateDataKey` for destination writes).

### 3. Package and deploy Lambda

Use a Lambda-compatible Linux environment to package `sharp` (for example, an Amazon Linux Docker image or a Lambda Layer). From this repository:

```bash
npm install --omit=dev
zip -r function.zip index.js node_modules package.json
```

Create a Lambda function with these settings:

| Setting | Value |
| --- | --- |
| Runtime | Node.js 20.x |
| Handler | `index.handler` |
| Architecture | x86_64 (or build Sharp for arm64 if selected) |
| Environment variable | `DESTINATION_BUCKET=<your-destination-bucket>` |
| Memory | 1024 MB recommended |
| Timeout | 30 seconds recommended |

Upload `function.zip` or deploy the same artifact through your infrastructure-as-code pipeline. For production, set a log-retention policy on `/aws/lambda/<function-name>` and configure a dead-letter queue or on-failure destination for event processing failures.

#### AWS SAM deployment

This repository also includes [`template.yaml`](template.yaml), which creates encrypted source and destination buckets, a least-privilege Lambda role, and the source-bucket S3 trigger. Build Sharp for the Lambda runtime and deploy:

```bash
sam build --use-container
sam deploy --guided
```

`sam build --use-container` requires Docker and ensures Sharp is compiled for Amazon Linux. For production deployments, use a dedicated artifact bucket, enable Lambda tracing and log retention, and configure an S3 event failure destination.

### 4. Add the S3 trigger and test

On the **source** bucket, add an event notification for `s3:ObjectCreated:*` targeting the Lambda function. Optionally limit notifications using prefixes/suffixes such as `uploads/` and `.jpg`, `.jpeg`, or `.png`. Grant S3 permission to invoke the Lambda function when prompted by the console or deployment tool.

Upload a test image to the selected source prefix. A file with the same path and a `.webp` extension should appear in the destination bucket.

## Operational Notes

- Source object keys are URL-decoded correctly, including spaces encoded as `+`.
- Images are not enlarged; narrower images retain their original width.
- EXIF orientation is applied before output, avoiding sideways mobile photos.
- The Lambda response fails the affected S3 record when processing fails, allowing S3 event retries according to your notification configuration.
