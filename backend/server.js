const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

const app = express();

app.use(helmet());

// CORS configuration
app.use(cors({
    origin: process.env.NODE_ENV === 'production'
        ? ['https://yourdomain.com', 'https://www.yourdomain.com']
        : ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://127.0.0.1:5500'],
    credentials: true
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: process.env.NODE_ENV === 'production' ? 100 : 1000, // limit each IP to 100 requests per windowMs in production
    message: {
        error: 'Too many requests from this IP, please try again later.',
        retryAfter: 15
    }
});
app.use(limiter);

// Stricter rate limiting for auth endpoints
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5, // 5 attempts per 15 minutes
    skipSuccessfulRequests: true
});

// Body parser middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static files (for frontend)
app.use(express.static(path.join(__dirname, '../frontend')));

// Test database connection on startup
const db = require('./config/database');

// Routes
app.use('/api/auth', authLimiter, require('./routes/auth'));
app.use('/api/patients', require('./routes/patients'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/documents', require('./routes/documents'));
// app.use('/api/appointments', require('./routes/appointments'));
// app.use('/api/health-metrics', require('./routes/healthMetrics'));

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// Serve frontend routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/login.html'));
});

app.get('/patient-dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/patient-dashboard.html'));
});

app.get('/doctor-dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/doctor-dashboard.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err);

    // Log error details for debugging
    console.error('Stack:', err.stack);

    // Don't leak error details in production
    if (process.env.NODE_ENV === 'production') {
        return res.status(500).json({
            error: 'Internal server error',
            message: 'Something went wrong'
        });
    }

    res.status(err.status || 500).json({
        error: err.message,
        stack: err.stack
    });
});

// Handle 404
app.use('*', (req, res) => {
    if (req.originalUrl.startsWith('/api/')) {
        res.status(404).json({ error: 'API endpoint not found' });
    } else {
        res.sendFile(path.join(__dirname, '../frontend/index.html'));
    }
});

const PORT = process.env.PORT || 3000;

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    server.close(() => {
        console.log('Process terminated');
        db.end();
    });
});

const server = app.listen(PORT, () => {
    console.log(`🚀 Sehat Setu server running on port ${PORT}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`📡 Health check: http://localhost:${PORT}/api/health`);
});

module.exports = app;