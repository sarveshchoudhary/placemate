FROM node:22

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

ENV NODE_ENV=production
ENV PYTHONUNBUFFERED=1

EXPOSE 3002 50051
CMD ["node", "server.js"]