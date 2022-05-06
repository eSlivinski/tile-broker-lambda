import serverless from 'serverless-http';
import express from 'express';
import * as AWS from 'aws-sdk';
import { Request, Response, NextFunction } from 'express';
import { validationResult, param } from 'express-validator';
import axios from 'axios';

const app = express();
app.use(express.json());

const { S3_BUCKET, S3_PATH_TILE_CACHE, S3_PATH_STYLE_CONFIG, RENDER_URL } = process.env;

if (!S3_BUCKET || !S3_PATH_TILE_CACHE || !S3_PATH_STYLE_CONFIG || !RENDER_URL) {
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

  param('x').toInt().isInt().withMessage('x must be an integer'),

  param('y').toInt().isInt().withMessage('y must be an integer'),
];

// XXX: this is currently based on extremely coarse logic
async function validateTileset(tilesetId: number): Promise<boolean> {
  const request: AWS.S3.ListObjectsRequest = {
    Bucket: S3_BUCKET!,
    Prefix: `${S3_PATH_STYLE_CONFIG}/${tilesetId}.xml`,
  };
  const data = await S3.listObjects(request).promise();

  return data?.Contents?.length === 1;
}

async function fetchCachedTile(
  tilesetId: number,
  z: number,
  x: number,
  y: number,
): Promise<{ success: true; result: AWS.S3.Body } | { success: false; error: string }> {
  try {
    const request: AWS.S3.GetObjectRequest = {
      Bucket: S3_BUCKET!,
      Key: `${S3_PATH_TILE_CACHE}/${tilesetId}/${z}/${x}/${y}.png`,
    };
    const data = await S3.getObject(request).promise();

    if (!data.Body) throw new Error('The requested tile did not contain any data');

    const result = data.Body;

    return { success: true, result };
  } catch (error: any) {
    return { success: false, error };
  }
}

async function renderTile(tilesetId: number, z: number, x: number, y: number): Promise<any> {
  const renderTileLambda = `${RENDER_URL!}/${tilesetId}/${z}/${x}/${y}.png`;
  const response = await axios.get(renderTileLambda, {
    responseType: 'arraybuffer',
  });
  return response.data;
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

      // Params are already coerced to numeric in the validation
      const tilesetId: number = +req.params.tilesetId;
      const z: number = +req.params.z;
      const x: number = +req.params.x;
      const y: number = +req.params.y;

      // const tilesetIsValid = await validateTileset(tilesetId);

      // if (!tilesetIsValid) {
      //   return res.status(404).json(`Unknown tileset: ${tilesetId}`);
      // }

      const cachedTileResponse = await fetchCachedTile(tilesetId, z, x, y);
      let tile;

      if (cachedTileResponse.success === true) {
        ({ result: tile } = cachedTileResponse);
      } else {
        tile = await renderTile(tilesetId, z, x, y);
      }

      const buffer = Buffer.from(tile, 'binary');

      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Length', buffer.length);
      return res.status(200).end(buffer);
    } catch (error) {
      return res.status(500).json(`Unexpected error occurred. ${JSON.stringify(error)}`);
    }
  },
);

module.exports.handler = serverless(app, {
  binary: ['application/json', 'image/png'],
});
