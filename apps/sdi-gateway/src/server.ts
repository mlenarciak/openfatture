import { configFromEnvironment, createGateway, createPeerVerifier } from './gateway.js';
import { createHttpServer } from './http.js';
import { S3InboxStore } from './s3-store.js';
const config = configFromEnvironment(process.env);
const store = new S3InboxStore(process.env.SDI_ARTIFACTS_BUCKET ?? '', process.env.SDI_KMS_KEY_ID ?? '');
const server = createHttpServer(createGateway(store, config), { proxyMode: process.env.SDI_PROXY_MODE, authorizePeer: createPeerVerifier(config), maxConcurrent: Number(process.env.SDI_MAX_CONCURRENT ?? 4) });
server.listen(Number(process.env.PORT ?? 8080), '0.0.0.0');
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 65_000).unref(); });
