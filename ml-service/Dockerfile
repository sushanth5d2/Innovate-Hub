# ML Service Dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies for opencv
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Non-root user
RUN useradd -m -r mluser && chown -R mluser:mluser /app
USER mluser

EXPOSE 5000

ENV FLASK_ENV=production

CMD ["gunicorn", "-w", "4", "-b", "0.0.0.0:5000", "app:app", "--access-logfile", "-", "--error-logfile", "-"]
