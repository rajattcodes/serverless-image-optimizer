'use strict';

const s3PutEvent = require('../events/s3-put-event.json');

const mockSend = jest.fn();
const mockToBuffer = jest.fn();
const mockWebp = jest.fn(() => ({ toBuffer: mockToBuffer }));
const mockResize = jest.fn(() => ({ webp: mockWebp }));
const mockRotate = jest.fn(() => ({ resize: mockResize }));
const mockSharp = jest.fn(() => ({ rotate: mockRotate }));

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: mockSend })),
  GetObjectCommand: jest.fn(function GetObjectCommand(input) {
    this.input = input;
  }),
  PutObjectCommand: jest.fn(function PutObjectCommand(input) {
    this.input = input;
  }),
}));

jest.mock('sharp', () => mockSharp);

describe('Serverless Image Optimizer Lambda', () => {
  let handler;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.DESTINATION_BUCKET = 'optimized-images-test';
    ({ handler } = require('../index'));
  });

  afterAll(() => {
    delete process.env.DESTINATION_BUCKET;
  });

  it('reads an uploaded object and writes the optimized WebP to the destination bucket', async () => {
    const sourceImage = Uint8Array.from([1, 2, 3]);
    const optimizedImage = Buffer.from('optimized-webp');
    mockSend
      .mockResolvedValueOnce({
        Body: { transformToByteArray: jest.fn().mockResolvedValue(sourceImage) },
      })
      .mockResolvedValueOnce({});
    mockToBuffer.mockResolvedValue(optimizedImage);

    const result = await handler(s3PutEvent);

    expect(result).toMatchObject({
      statusCode: 200,
      processed: 1,
      results: [
        {
          sourceBucket: 'source-images-example',
          sourceKey: 'uploads/summer photo.jpg',
          destinationBucket: 'optimized-images-test',
          destinationKey: 'uploads/summer photo.webp',
        },
      ],
    });
    expect(mockSend.mock.calls[0][0].input).toEqual({
      Bucket: 'source-images-example',
      Key: 'uploads/summer photo.jpg',
    });
    expect(mockSend.mock.calls[1][0].input).toMatchObject({
      Bucket: 'optimized-images-test',
      Key: 'uploads/summer photo.webp',
      Body: optimizedImage,
      ContentType: 'image/webp',
      CacheControl: 'public, max-age=31536000, immutable',
    });
  });

  it('applies EXIF orientation before resizing', async () => {
    mockSend
      .mockResolvedValueOnce({ Body: { transformToByteArray: jest.fn().mockResolvedValue(new Uint8Array()) } })
      .mockResolvedValueOnce({});
    mockToBuffer.mockResolvedValue(Buffer.from('optimized-webp'));

    await handler(s3PutEvent);

    expect(mockSharp).toHaveBeenCalledWith(expect.any(Uint8Array), { failOn: 'none' });
    expect(mockRotate).toHaveBeenCalledWith();
    expect(mockResize).toHaveBeenCalledWith({ width: 1920, withoutEnlargement: true });
  });

  it('converts images to WebP at quality 80', async () => {
    mockSend
      .mockResolvedValueOnce({ Body: { transformToByteArray: jest.fn().mockResolvedValue(new Uint8Array()) } })
      .mockResolvedValueOnce({});
    mockToBuffer.mockResolvedValue(Buffer.from('optimized-webp'));

    await handler(s3PutEvent);

    expect(mockWebp).toHaveBeenCalledWith({ quality: 80 });
    expect(mockToBuffer).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid S3 event records', async () => {
    await expect(handler({ Records: [{}] })).rejects.toThrow(
      'Received an S3 event record without a bucket name or object key.',
    );
    expect(mockSend).not.toHaveBeenCalled();
  });
});
