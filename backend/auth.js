const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const Joi = require('joi');
const db = require('../config/database');
const { generateToken, generateRefreshToken, verifyRefreshToken, authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Validation schemas
const registerSchema = Joi.object({
    name: Joi.string().min(2).max(100).required(),
    email: Joi.string().email().required(),
    password: Joi.string().min(6).max(50).required(),
    userType: Joi.string().valid('patient', 'doctor').required(),
    phone: Joi.string().pattern(/^[+]?[\d\s-()]+$/).optional(),
    // Doctor-specific fields
    licenseNumber: Joi.string().when('userType', { 
        is: 'doctor', 
        then: Joi.required(),
        otherwise: Joi.forbidden()
    }),
    specialty: Joi.string().when('userType', { 
        is: 'doctor', 
        then: Joi.required(),
        otherwise: Joi.forbidden()
    }),
    experience: Joi.number().min(0).max(70).when('userType', { 
        is: 'doctor', 
        then: Joi.required(),
        otherwise: Joi.forbidden()
    }),
    // Patient-specific fields
    dateOfBirth: Joi.date().when('userType', { 
        is: 'patient', 
        then: Joi.required(),
        otherwise: Joi.forbidden()
    }),
    gender: Joi.string().valid('male', 'female', 'other').when('userType', { 
        is: 'patient', 
        then: Joi.required(),
        otherwise: Joi.forbidden()
    }),
    bloodGroup: Joi.string().valid('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-').when('userType', { 
        is: 'patient', 
        then: Joi.optional(),
        otherwise: Joi.forbidden()
    })
});

const loginSchema = Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required()
});

// Helper function to generate unique IDs
const generateUniqueId = (userType) => {
    const prefix = userType === 'patient' ? 'PSS' : 'DSS';
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `${prefix}${timestamp}${random}`;
};

// Register endpoint
router.post('/register', async (req, res) => {
    try {
        // Validate request body
        const { error, value } = registerSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                error: 'Validation failed',
                details: error.details[0].message
            });
        }

        const { name, email, password, userType, phone, licenseNumber, specialty, experience, dateOfBirth, gender, bloodGroup } = value;

        // Check if user already exists
        const existingUser = await db.findOne('users', { email });
        if (existingUser) {
            return res.status(409).json({
                error: 'User already exists',
                message: 'An account with this email already exists'
            });
        }

        // For doctors, check if license number already exists
        if (userType === 'doctor') {
            const existingLicense = await db.findOne('doctors', { license_number: licenseNumber });
            if (existingLicense) {
                return res.status(409).json({
                    error: 'License number already registered',
                    message: 'A doctor with this license number already exists'
                });
            }
        }

        // Hash password
        const saltRounds = 12;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        // Generate unique user ID
        const userId = `USER_${uuidv4().replace(/-/g, '')}`;

        // Start transaction
        const queries = [
            {
                sql: 'INSERT INTO users (id, email, password_hash, user_type, is_active) VALUES (?, ?, ?, ?, ?)',
                params: [userId, email, passwordHash, userType, true]
            }
        ];

        // Add user-specific data
        if (userType === 'patient') {
            const patientId = generateUniqueId('patient');
            queries.push({
                sql: `INSERT INTO patients (id, user_id, name, date_of_birth, gender, phone, blood_group) 
                      VALUES (?, ?, ?, ?, ?, ?, ?)`,
                params: [patientId, userId, name, dateOfBirth, gender, phone || null, bloodGroup || null]
            });
        } else if (userType === 'doctor') {
            const doctorId = generateUniqueId('doctor');
            queries.push({
                sql: `INSERT INTO doctors (id, user_id, name, license_number, specialty, experience_years, phone, is_verified) 
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                params: [doctorId, userId, name, licenseNumber, specialty, experience, phone || null, false]
            });
        }

        // Execute transaction
        await db.transaction(queries);

        // Log audit
        await db.logAudit(userId, userType, 'REGISTER', 'user', userId, null, { email, userType }, req.ip, req.get('User-Agent'));

        res.status(201).json({
            message: 'Registration successful',
            user: {
                id: userId,
                email,
                userType,
                name
            }
        });

    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({
            error: 'Registration failed',
            message: 'An error occurred during registration'
        });
    }
});

// Login endpoint
router.post('/login', async (req, res) => {
    try {
        // Validate request body
        const { error, value } = loginSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                error: 'Validation failed',
                details: error.details[0].message
            });
        }

        const { email, password } = value;

        // Find user
        const user = await db.findOne('users', { email });
        if (!user) {
            return res.status(401).json({
                error: 'Invalid credentials',
                message: 'Email or password is incorrect'
            });
        }

        // Check if account is locked
        if (user.locked_until && new Date(user.locked_until) > new Date()) {
            return res.status(423).json({
                error: 'Account locked',
                message: 'Account is temporarily locked due to too many failed attempts',
                lockedUntil: user.locked_until
            });
        }

        // Check if account is active
        if (!user.is_active) {
            return res.status(403).json({
                error: 'Account inactive',
                message: 'Your account has been deactivated'
            });
        }

        // Verify password
        const isValidPassword = await bcrypt.compare(password, user.password_hash);
        if (!isValidPassword) {
            // Increment login attempts
            const loginAttempts = (user.login_attempts || 0) + 1;
            const updateData = { login_attempts: loginAttempts };

            // Lock account after 5 failed attempts
            if (loginAttempts >= 5) {
                updateData.locked_until = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
            }

            await db.update('users', updateData, { id: user.id });

            return res.status(401).json({
                error: 'Invalid credentials',
                message: 'Email or password is incorrect',
                attemptsRemaining: Math.max(0, 5 - loginAttempts)
            });
        }

        // Reset login attempts on successful login
        await db.update('users', { 
            login_attempts: 0, 
            locked_until: null,
            last_login: new Date()
        }, { id: user.id });

        // Get user profile data
        let profileData = {};
        if (user.user_type === 'patient') {
            profileData = await db.findOne('patients', { user_id: user.id });
        } else if (user.user_type === 'doctor') {
            profileData = await db.findOne('doctors', { user_id: user.id });
        }

        // Generate tokens
        const accessToken = generateToken(user.id, user.user_type);
        const refreshToken = generateRefreshToken(user.id);

        // Log audit
        await db.logAudit(user.id, user.user_type, 'LOGIN', 'user', user.id, null, null, req.ip, req.get('User-Agent'));

        res.json({
            message: 'Login successful',
            user: {
                id: user.id,
                email: user.email,
                userType: user.user_type,
                emailVerified: user.email_verified,
                profile: profileData
            },
            tokens: {
                accessToken,
                refreshToken,
                expiresIn: '7d'
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            error: 'Login failed',
            message: 'An error occurred during login'
        });
    }
});

// Refresh token endpoint
router.post('/refresh', async (req, res) => {
    try {
        const { refreshToken } = req.body;

        if (!refreshToken) {
            return res.status(401).json({
                error: 'Refresh token required'
            });
        }

        const decoded = verifyRefreshToken(refreshToken);
        if (!decoded) {
            return res.status(403).json({
                error: 'Invalid refresh token'
            });
        }

        // Find user
        const user = await db.findById('users', decoded.userId);
        if (!user || !user.is_active) {
            return res.status(403).json({
                error: 'User not found or inactive'
            });
        }

        // Generate new access token
        const newAccessToken = generateToken(user.id, user.user_type);

        res.json({
            accessToken: newAccessToken,
            expiresIn: '7d'
        });

    } catch (error) {
        console.error('Token refresh error:', error);
        res.status(500).json({
            error: 'Token refresh failed'
        });
    }
});

// Logout endpoint
router.post('/logout', authenticateToken, async (req, res) => {
    try {
        // Log audit
        await db.logAudit(req.user.id, req.user.userType, 'LOGOUT', 'user', req.user.id, null, null, req.ip, req.get('User-Agent'));

        // In a production app, you'd maintain a blacklist of tokens
        // or use Redis to track active sessions
        
        res.json({
            message: 'Logout successful'
        });

    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({
            error: 'Logout failed'
        });
    }
});

// Get current user profile
router.get('/me', authenticateToken, async (req, res) => {
    try {
        const user = await db.findById('users', req.user.id);
        
        let profileData = {};
        if (user.user_type === 'patient') {
            profileData = await db.findOne('patients', { user_id: user.id });
        } else if (user.user_type === 'doctor') {
            profileData = await db.findOne('doctors', { user_id: user.id });
        }

        res.json({
            user: {
                id: user.id,
                email: user.email,
                userType: user.user_type,
                emailVerified: user.email_verified,
                isActive: user.is_active,
                createdAt: user.created_at,
                lastLogin: user.last_login
            },
            profile: profileData
        });

    } catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json({
            error: 'Failed to fetch profile'
        });
    }
});

// Change password
router.put('/change-password', authenticateToken, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                error: 'Current password and new password are required'
            });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({
                error: 'New password must be at least 6 characters long'
            });
        }

        // Get current user
        const user = await db.findById('users', req.user.id);
        
        // Verify current password
        const isValidPassword = await bcrypt.compare(currentPassword, user.password_hash);
        if (!isValidPassword) {
            return res.status(401).json({
                error: 'Current password is incorrect'
            });
        }

        // Hash new password
        const saltRounds = 12;
        const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);

        // Update password
        await db.update('users', { password_hash: newPasswordHash }, { id: user.id });

        // Log audit
        await db.logAudit(req.user.id, req.user.userType, 'CHANGE_PASSWORD', 'user', req.user.id, null, null, req.ip, req.get('User-Agent'));

        res.json({
            message: 'Password changed successfully'
        });

    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({
            error: 'Failed to change password'
        });
    }
});

// Forgot password endpoint
router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({
                error: 'Email is required'
            });
        }

        const user = await db.findOne('users', { email });
        
        // Always return success to prevent email enumeration
        res.json({
            message: 'If an account with that email exists, a password reset link has been sent'
        });

        if (user) {
            // Generate reset token
            const resetToken = jwt.sign(
                { userId: user.id, purpose: 'reset' },
                process.env.JWT_SECRET,
                { expiresIn: '1h' }
            );

            // Save reset token
            await db.update('users', {
                reset_token: resetToken,
                reset_token_expires: new Date(Date.now() + 60 * 60 * 1000) // 1 hour
            }, { id: user.id });

            // In production, send email here
            console.log(`Password reset link: ${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`);

            // Log audit
            await db.logAudit(user.id, user.user_type, 'FORGOT_PASSWORD', 'user', user.id, null, null, req.ip, req.get('User-Agent'));
        }

    } catch (error) {
        console.error('Forgot password error:', error);
        res.status(500).json({
            error: 'Failed to process password reset request'
        });
    }
});

// Reset password endpoint
router.post('/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body;

        if (!token || !newPassword) {
            return res.status(400).json({
                error: 'Reset token and new password are required'
            });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({
                error: 'New password must be at least 6 characters long'
            });
        }

        // Verify reset token
        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET);
        } catch (error) {
            return res.status(400).json({
                error: 'Invalid or expired reset token'
            });
        }

        if (decoded.purpose !== 'reset') {
            return res.status(400).json({
                error: 'Invalid reset token'
            });
        }

        // Find user with valid reset token
        const user = await db.findOne('users', {
            id: decoded.userId,
            reset_token: token
        });

        if (!user || new Date(user.reset_token_expires) < new Date()) {
            return res.status(400).json({
                error: 'Invalid or expired reset token'
            });
        }

        // Hash new password
        const saltRounds = 12;
        const passwordHash = await bcrypt.hash(newPassword, saltRounds);

        // Update password and clear reset token
        await db.update('users', {
            password_hash: passwordHash,
            reset_token: null,
            reset_token_expires: null,
            login_attempts: 0,
            locked_until: null
        }, { id: user.id });

        // Log audit
        await db.logAudit(user.id, user.user_type, 'RESET_PASSWORD', 'user', user.id, null, null, req.ip, req.get('User-Agent'));

        res.json({
            message: 'Password reset successful'
        });

    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({
            error: 'Failed to reset password'
        });
    }
});

module.exports = router;
