'use strict';

const path = require('node:path');
const { GetObjectCommand, PutObjectCommand, S3Client } = require('@aws-sdk/client-s3');
const sharp = require('sharp');

const s3 = new S3Client({});
const destinationBucket = process.env.DESTINATION_BUCKET;
const maxWidth = 1920;
const webpQuality = 80;

if (!destinationBucket) {
  throw new Error('The DESTINATION_BUCKET environment variable is required.');
}

exports.handler = async (event) => {
  const records = event.Records ?? [];
  const results = await Promise.all(records.map(processRecord));

  return {
    statusCode: 200,
    processed: results.length,
    results,
  };
};

async function processRecord(record) {
  const sourceBucket = record.s3?.bucket?.name;
  const encodedKey = record.s3?.object?.key;

  if (!sourceBucket || !encodedKey) {
    throw new Error('Received an S3 event record without a bucket name or object key.');
  }

  const sourceKey = decodeS3Key(encodedKey);
  const response = await s3.send(
    new GetObjectCommand({ Bucket: sourceBucket, Key: sourceKey }),
  );

  if (!response.Body) {
    throw new Error(`S3 object body is empty: s3://${sourceBucket}/${sourceKey}`);
  }

  const imageBuffer = await response.Body.transformToByteArray();
  const optimizedImage = await sharp(imageBuffer, { failOn: 'none' })
    .rotate()
    .resize({ width: maxWidth, withoutEnlargement: true })
    .webp({ quality: webpQuality })
    .toBuffer();

  const destinationKey = toWebpKey(sourceKey);
  await s3.send(
    new PutObjectCommand({
      Bucket: destinationBucket,
      Key: destinationKey,
      Body: optimizedImage,
      ContentType: 'image/webp',
      CacheControl: 'public, max-age=31536000, immutable',
      Metadata: {
        'source-key': sourceKey,
        'optimization': `webp-q${webpQuality}-maxw${maxWidth}`,
      },
    }),
  );

  console.info('Image optimized', {
    source: `s3://${sourceBucket}/${sourceKey}`,
    destination: `s3://${destinationBucket}/${destinationKey}`,
  });

  return { sourceBucket, sourceKey, destinationBucket, destinationKey };
}

function decodeS3Key(encodedKey) {
  return decodeURIComponent(encodedKey.replace(/\+/g, ' '));
}

function toWebpKey(sourceKey) {
  const extension = path.posix.extname(sourceKey);
  return extension ? `${sourceKey.slice(0, -extension.length)}.webp` : `${sourceKey}.webp`;
}
