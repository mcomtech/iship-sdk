# Build from the repository root, because the app depends on the SDK in node/
# and on integrations/connect:
#
#   docker build -f integrations/shopify-app/Dockerfile -t iship-shopify-app .
#
FROM node:22-alpine AS build
RUN apk add --no-cache openssl
WORKDIR /repo

COPY node/ node/
COPY integrations/connect/ integrations/connect/
COPY integrations/shopify-app/ integrations/shopify-app/
RUN rm -rf node/node_modules node/dist integrations/connect/node_modules integrations/connect/dist \
      integrations/shopify-app/node_modules integrations/shopify-app/build

RUN cd node && npm install --no-audit --no-fund && npm run build
RUN cd integrations/connect && npm install --no-audit --no-fund && npm run build
WORKDIR /repo/integrations/shopify-app
RUN npm install --no-audit --no-fund && npm run build && npm prune --omit=dev

FROM node:22-alpine
RUN apk add --no-cache openssl
ENV NODE_ENV=production
EXPOSE 3000
COPY --from=build /repo /repo
WORKDIR /repo/integrations/shopify-app
CMD ["npm", "run", "docker-start"]
