import * as serverless from 'serverless-http';
import * as express from 'express';
import { Request, Response, NextFunction } from 'express';

// import * as AWS from 'aws-sdk';

const app = express();
app.use(express.json());

app.get('/hello', async (req: Request, res: Response, next: NextFunction) => {
  const result = { data: 'HELLO WORLD' }

  return res.status(200).json(result);
});

module.exports.handler = serverless(app);