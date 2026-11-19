// Vercel serverless entry: the whole NestJS API as one function (built by `npm run vercel-build` into dist/).
// The app is created once per warm instance and reused across requests.
let server;
module.exports = async (req, res) => {
  if (!server) {
    const { createApp } = require('../dist/main');
    const app = await createApp();
    const { DocumentBuilder, SwaggerModule } = require('@nestjs/swagger');
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('MonoSource API').setVersion('0.2').addBearerAuth().build()));
    await app.init();
    server = app.getHttpAdapter().getInstance();
  }
  return server(req, res);
};
