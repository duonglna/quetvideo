// yt-dlp API Server for n8n
// Install: npm install express cors axios child_process

const express = require('express');
const cors = require('cors');
const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');

const execAsync = promisify(exec);
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Create directories
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR);

// Cleanup old files (older than 2 hours)
const cleanupOldFiles = () => {
  const now = Date.now();
  const twoHours = 2 * 60 * 60 * 1000;
  
  fs.readdirSync(DOWNLOADS_DIR).forEach(file => {
    const filePath = path.join(DOWNLOADS_DIR, file);
    const stat = fs.statSync(filePath);
    if (now - stat.mtimeMs > twoHours) {
      fs.unlinkSync(filePath);
      console.log(`Deleted old file: ${file}`);
    }
  });
};

setInterval(cleanupOldFiles, 30 * 60 * 1000); // Every 30 minutes

// Check if yt-dlp is installed
const checkYtDlp = async () => {
  try {
    await execAsync('yt-dlp --version');
    return true;
  } catch (error) {
    return false;
  }
};

// API: Health Check
app.get('/api/health', async (req, res) => {
  const ytdlpInstalled = await checkYtDlp();
  res.json({
    success: true,
    message: 'API is running',
    ytdlpInstalled,
    timestamp: new Date().toISOString()
  });
});

// API: Get Video Info (without downloading)
app.post('/api/info', async (req, res) => {
  const { url } = req.body;
  
  if (!url) {
    return res.status(400).json({
      success: false,
      error: 'URL is required'
    });
  }
  
  try {
    const cmd = `yt-dlp --dump-json "${url}"`;
    const { stdout } = await execAsync(cmd);
    const info = JSON.parse(stdout);
    
    res.json({
      success: true,
      data: {
        title: info.title,
        duration: info.duration,
        thumbnail: info.thumbnail,
        description: info.description,
        uploader: info.uploader,
        upload_date: info.upload_date,
        view_count: info.view_count,
        formats: info.formats?.map(f => ({
          format_id: f.format_id,
          ext: f.ext,
          resolution: f.resolution,
          filesize: f.filesize
        })) || []
      }
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// API: Download Video (Best Quality)
app.post('/api/download', async (req, res) => {
  const { url, format = 'mp4', quality = 'best' } = req.body;
  
  if (!url) {
    return res.status(400).json({
      success: false,
      error: 'URL is required'
    });
  }
  
  const jobId = `video_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const outputPath = path.join(DOWNLOADS_DIR, `${jobId}.${format}`);
  
  try {
    // Build yt-dlp command
    let formatStr = 'bestvideo+bestaudio/best';
    
    if (quality === 'best') {
      formatStr = format === 'mp4' 
        ? 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best'
        : 'bestvideo+bestaudio/best';
    } else if (quality === '1080p') {
      formatStr = 'bestvideo[height<=1080]+bestaudio/best[height<=1080]';
    } else if (quality === '720p') {
      formatStr = 'bestvideo[height<=720]+bestaudio/best[height<=720]';
    } else if (quality === '480p') {
      formatStr = 'bestvideo[height<=480]+bestaudio/best[height<=480]';
    }
    
    // Use spawn instead of exec to avoid shell parsing issues
    await new Promise((resolve, reject) => {
      const args = [
        '-f', formatStr,
        '--merge-output-format', format,
        '-o', outputPath,
        '--no-playlist',
        url
      ];
      
      console.log(`Executing: yt-dlp ${args.join(' ')}`);
      
      const process = spawn('yt-dlp', args);
      let stderr = '';
      
      process.stderr.on('data', (data) => {
        stderr += data.toString();
        console.log(data.toString());
      });
      
      process.stdout.on('data', (data) => {
        console.log(data.toString());
      });
      
      process.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(stderr || `Process exited with code ${code}`));
        }
      });
      
      process.on('error', reject);
    });
    
    // Check if file exists
    if (!fs.existsSync(outputPath)) {
      throw new Error('Download completed but file not found');
    }
    
    const fileName = `${jobId}.${format}`;
    const downloadUrl = `${req.protocol}://${req.get('host')}/api/file/${fileName}`;
    
    res.json({
      success: true,
      message: 'Download completed',
      jobId,
      fileName,
      downloadUrl
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      jobId
    });
  }
});

// API: Download Audio Only (MP3)
app.post('/api/download-audio', async (req, res) => {
  const { url, format = 'mp3' } = req.body;
  
  if (!url) {
    return res.status(400).json({
      success: false,
      error: 'URL is required'
    });
  }
  
  const jobId = `audio_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const outputPath = path.join(DOWNLOADS_DIR, `${jobId}.${format}`);
  
  try {
    // Use spawn to avoid shell parsing issues
    await new Promise((resolve, reject) => {
      const args = [
        '-x',
        '--audio-format', format,
        '--audio-quality', '0',
        '-o', outputPath,
        '--no-playlist',
        url
      ];
      
      console.log(`Executing: yt-dlp ${args.join(' ')}`);
      
      const process = spawn('yt-dlp', args);
      let stderr = '';
      
      process.stderr.on('data', (data) => {
        stderr += data.toString();
        console.log(data.toString());
      });
      
      process.stdout.on('data', (data) => {
        console.log(data.toString());
      });
      
      process.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(stderr || `Process exited with code ${code}`));
        }
      });
      
      process.on('error', reject);
    });
    
    // Check if file exists
    if (!fs.existsSync(outputPath)) {
      throw new Error('Download completed but file not found');
    }
    
    const fileName = `${jobId}.${format}`;
    const downloadUrl = `${req.protocol}://${req.get('host')}/api/file/${fileName}`;
    
    res.json({
      success: true,
      message: 'Audio download completed',
      jobId,
      fileName,
      downloadUrl
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      jobId
    });
  }
});

// API: Download with Progress (Streaming response)
app.post('/api/download-stream', (req, res) => {
  const { url, format = 'mp4', quality = 'best' } = req.body;
  
  if (!url) {
    return res.status(400).json({
      success: false,
      error: 'URL is required'
    });
  }
  
  const jobId = `video_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const outputTemplate = path.join(DOWNLOADS_DIR, `${jobId}.%(ext)s`);
  
  let formatStr = format === 'mp4' 
    ? 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best'
    : 'bestvideo+bestaudio/best';
  
  const args = [
    '-f', formatStr,
    '--merge-output-format', format,
    '-o', outputTemplate,
    '--no-playlist',
    '--newline',
    url
  ];
  
  // Set headers for streaming
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  const ytdlp = spawn('yt-dlp', args);
  
  ytdlp.stdout.on('data', (data) => {
    const output = data.toString();
    res.write(`data: ${JSON.stringify({ type: 'progress', message: output })}\n\n`);
  });
  
  ytdlp.stderr.on('data', (data) => {
    const output = data.toString();
    res.write(`data: ${JSON.stringify({ type: 'log', message: output })}\n\n`);
  });
  
  ytdlp.on('close', (code) => {
    if (code === 0) {
      const files = fs.readdirSync(DOWNLOADS_DIR)
        .filter(f => f.startsWith(jobId));
      
      if (files.length > 0) {
        const fileName = files[0];
        const downloadUrl = `${req.protocol}://${req.get('host')}/api/file/${fileName}`;
        
        res.write(`data: ${JSON.stringify({ 
          type: 'complete', 
          success: true,
          fileName,
          downloadUrl 
        })}\n\n`);
      } else {
        res.write(`data: ${JSON.stringify({ 
          type: 'error', 
          message: 'File not found after download' 
        })}\n\n`);
      }
    } else {
      res.write(`data: ${JSON.stringify({ 
        type: 'error', 
        message: `Process exited with code ${code}` 
      })}\n\n`);
    }
    res.end();
  });
});

// API: Get Downloaded File
app.get('/api/file/:filename', (req, res) => {
  const { filename } = req.params;
  const filePath = path.join(DOWNLOADS_DIR, filename);
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({
      success: false,
      error: 'File not found'
    });
  }
  
  res.download(filePath, filename, (err) => {
    if (err) {
      res.status(500).json({
        success: false,
        error: 'Download failed'
      });
    }
  });
});

// API: List Downloaded Files
app.get('/api/files', (req, res) => {
  try {
    const files = fs.readdirSync(DOWNLOADS_DIR).map(file => {
      const filePath = path.join(DOWNLOADS_DIR, file);
      const stat = fs.statSync(filePath);
      return {
        name: file,
        size: stat.size,
        created: stat.birthtime,
        downloadUrl: `${req.protocol}://${req.get('host')}/api/file/${file}`
      };
    });
    
    res.json({
      success: true,
      files
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// API: Delete File
app.delete('/api/file/:filename', (req, res) => {
  const { filename } = req.params;
  const filePath = path.join(DOWNLOADS_DIR, filename);
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({
      success: false,
      error: 'File not found'
    });
  }
  
  try {
    fs.unlinkSync(filePath);
    res.json({
      success: true,
      message: 'File deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Start server
app.listen(PORT, async () => {
  console.log(`🚀 yt-dlp API Server running on port ${PORT}`);
  console.log(`\n📌 API Endpoints:`);
  console.log(`  GET  /api/health - Health check`);
  console.log(`  POST /api/info - Get video info`);
  console.log(`  POST /api/download - Download video`);
  console.log(`  POST /api/download-audio - Download audio only`);
  console.log(`  POST /api/download-stream - Download with progress`);
  console.log(`  GET  /api/file/:filename - Get downloaded file`);
  console.log(`  GET  /api/files - List all files`);
  console.log(`  DELETE /api/file/:filename - Delete file`);
  
  const ytdlpInstalled = await checkYtDlp();
  console.log(`\n✅ yt-dlp installed: ${ytdlpInstalled}`);
  
  if (!ytdlpInstalled) {
    console.log('\n⚠️  yt-dlp not found! Install it:');
    console.log('   - Ubuntu/Debian: sudo apt install yt-dlp');
    console.log('   - macOS: brew install yt-dlp');
    console.log('   - pip: pip install yt-dlp');
  }
});
