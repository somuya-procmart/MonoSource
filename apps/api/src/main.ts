import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { logger: process.env.NODE_ENV === 'test' ? false : ['log', 'warn', 'error'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }));
  app.enableCors({ origin: (process.env.WEB_ORIGIN || 'http://localhost:3000').split(',') });
  app.use((_req: any, res: any, next: any) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY'); next(); });
  return app;
}

async function main() {
  const app = await createApp();
  const doc = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('MonoSource API').setVersion('0.1').addBearerAuth().build());
  SwaggerModule.setup('docs', app, doc);
  const port = Number(process.env.PORT || 4000);
  await app.listen(port);
  console.log(`MonoSource API on :${port}  (OpenAPI at /docs)`);
}
if (require.main === module) main();
