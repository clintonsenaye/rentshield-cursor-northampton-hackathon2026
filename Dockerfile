FROM python:3.11-slim

WORKDIR /app

# Copy requirements first for better Docker layer caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Create uploads directory and make entrypoint executable
RUN mkdir -p static/uploads && chmod +x entrypoint.sh

# Expose port
EXPOSE 8000

# Health check (longer start period to allow DB seeding)
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

# Seed the database and start the server
CMD ["./entrypoint.sh"]
