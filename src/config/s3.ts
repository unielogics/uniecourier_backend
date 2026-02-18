import AWS from 'aws-sdk'

const region = process.env.AWS_REGION || 'us-east-1'
const bucket = process.env.S3_POD_BUCKET || 'uniecourier-pod'
const prefix = process.env.S3_POD_PREFIX || 'pod/'

export const s3 = new AWS.S3({ region })

export function getPODBucket(): string {
  return bucket
}

export function getPODPrefix(): string {
  return prefix
}

/** Key for a POD image: pod/{routeId}/{stopId}/{timestamp}.{ext} */
export function podKey(routeId: string, stopId: string, filename: string): string {
  return `${prefix}${routeId}/${stopId}/${filename}`
}

/** Generate presigned URL for upload (driver) or download (dashboard) */
export function getPresignedUrl(
  key: string,
  operation: 'getObject' | 'putObject',
  expiresIn = 3600
): string {
  return s3.getSignedUrl(operation, {
    Bucket: bucket,
    Key: key,
    Expires: expiresIn,
  })
}
