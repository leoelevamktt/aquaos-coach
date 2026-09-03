# Serviço de visão AquaVision: pose RTMO (ONNX Runtime) + tracking BYTE.
# Os pesos do modelo são baixados no primeiro início para /models (volume de cache).
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    VISION_HOST=0.0.0.0 \
    VISION_PORT=8800 \
    VISION_MODEL_DIR=/models \
    VISION_MEDIA_ROOT=/app/apps/api/storage/uploads

WORKDIR /app

COPY services/vision/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY services/vision/app ./app

EXPOSE 8800
VOLUME /models

CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8800"]
