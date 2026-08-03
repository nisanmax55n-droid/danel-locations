FROM node:22-alpine AS frontend
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend ./backend
COPY --from=frontend /app/dist ./dist
EXPOSE 8000
CMD ["sh", "-c", "uvicorn backend.entry:app --host 0.0.0.0 --port ${PORT:-8000}"]
