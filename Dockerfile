# Use Ubuntu-based Node image (better for yt-dlp)
FROM node:18

# Install system dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    wget \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp via pip (most reliable)
RUN python3 -m pip install --upgrade pip setuptools wheel && \
    python3 -m pip install -U yt-dlp

# Verify yt-dlp is installed and working
RUN yt-dlp --version && echo "✅ yt-dlp installed successfully"

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install Node.js dependencies
RUN npm install --production

# Copy application code
COPY server.js ./

# Create downloads directory
RUN mkdir -p downloads

# Expose port (Railway sets PORT env variable)
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:${PORT:-3000}/api/health || exit 1

# Start the application
CMD ["node", "server.js"]
