import * as serverless from 'serverless-http';
import * as express from 'express';
import * as AWS from 'aws-sdk';
import { Request, Response, NextFunction } from 'express';
import { validationResult, param } from 'express-validator';

const app = express();
app.use(express.json());

const { S3_BUCKET, S3_PATH_TILE_CACHE, S3_PATH_STYLE_CONFIG } = process.env;

if (!S3_BUCKET || !S3_PATH_TILE_CACHE || !S3_PATH_STYLE_CONFIG) {
  throw new Error('Missing required environment variables');
}

const S3 = new AWS.S3();

const fetchTileValidations = [
  param('tilesetId').toInt().isInt().withMessage('tilesetId must be an integer'),

  param('z')
    .toInt()
    .isInt()
    .custom((z: number): Boolean => z > 0 && z <= 22)
    .withMessage('z must be an integer between 1 and 22'),

  // TODO: make these more specific
  param('x').toInt().isInt().withMessage('x must be an integer'),

  param('y').toInt().isInt().withMessage('y must be an integer'),
];

async function getTile(
  tilesetId: number,
  z: number,
  x: number,
  y: number,
): Promise<{ success: true; result: string } | { success: false; error: string }> {
  try {
    const request: AWS.S3.GetObjectRequest = {
      Bucket: S3_BUCKET!,
      Key: `${S3_PATH_TILE_CACHE}/${tilesetId}/${z}/${x}/${y}.png`,
    };
    const data = await S3.getObject(request).promise();

    if (!data.Body) throw new Error('The requested tile did not contain any data');

    const result = data.Body.toString();

    return { success: true, result };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function tilesetExists(tilesetId: number): Promise<boolean> {
  const request: AWS.S3.ListObjectsRequest = {
    Bucket: S3_BUCKET!,
    Prefix: `${S3_PATH_STYLE_CONFIG}/${tilesetId}.xml`,
  };
  const data = await S3.listObjects(request).promise();

  return data?.Contents?.length === 1;
}

app.get(
  '/tiles/:tilesetId/:z/:x/:y.png',
  ...fetchTileValidations,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);

      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { tilesetId, z, x, y } = req.params;

      // Params are already coerced to numeric in the validation
      const tileResponse = await getTile(+tilesetId, +z, +x, +y);

      if (tileResponse.success === true) {
        return res.status(200).json(tileResponse.result);
      }

      const exists = await tilesetExists(+tilesetId);

      if (exists) {
        return res.status(201).json(`Tile doesn't exist... yet`);
      }

      return res.status(404).json(`Unknown tileset: ${tilesetId}`);
    } catch (error) {
      return res.status(500).json(error.message);
    }
  },
);

module.exports.handler = serverless(app);
