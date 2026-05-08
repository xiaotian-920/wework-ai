FROM node:22-bookworm
RUN apt-get update -qq && apt-get install -qqy --no-install-recommends git openssh-client curl jq file ca-certificates 2>&1 | tail -3
RUN npm install -g pnpm
RUN pnpm install -g openclaw@latest
RUN pnpm install -g clawhub@latest
WORKDIR /data
EXPOSE 49982 80
CMD ["openclaw", "gateway"]

# Deploy to Railway - Auto deploy on push
