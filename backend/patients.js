const express = require('express');
const Joi = require('joi');
const db = require('../config/database');
const { authenticateToken, requirePatient, requirePatientAccess } = require('../middleware/auth');

const router = express.Router();

// Apply authentication to all patient routes
router.use(authenticateToken);

// Validation schemas
const updateProfileSchema = Joi.object({
    name: Joi.string().min(2).max(100).required(),
    phone: Joi.string().pattern(/^[+]?[\d\s-()]+$/).allow(''),
    dateOfBirth: Joi.date().max('now').optional(),
    gender: Joi.string().valid('male', 'female', 'other').optional(),
    bloodGroup: Joi.string().valid('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-').allow(''),
    emergencyContact: Joi.string().pattern(/^[+]?[\d\s-()]+$/).allow(''),
    emergencyContactName: Joi.string().max(100).allow(''),
    address: Joi.string().max(500).allow(''),
    city: Joi.string().max(100).allow(''),
    state: Joi.string().max(100).allow(''),
    postalCode: Joi.string().max(20).allow(''),
    occupation: Joi.string().max(100).allow(''),
    medicalConditions: Joi.string().allow(''),
    allergies: Joi.string().allow(''),
    currentMedications: Joi.string().allow(''),
    insuranceProvider: Joi.string().max(255).allow(''),
    insuranceNumber: Joi.string().max(100).allow('')
});

const addHealthMetricSchema = Joi.object({
    metricType: Joi.string().valid('blood_pressure', 'heart_rate', 'temperature', 'weight', 'height', 'bmi', 'blood_sugar', 'oxygen_saturation', 'cholesterol', 'other').required(),
    value: Joi.string().max(100).required(),
    unit: Joi.string().max(20).optional(),
    systolic: Joi.number().integer().min(50).max(300).when('metricType', { is: 'blood_pressure', then: Joi.required() }),
    diastolic: Joi.number().integer().min(30).max(200).when('metricType', { is: 'blood_pressure', then: Joi.required() }),
    notes: Joi.string().max(500).allow(''),
    measurementDate: Joi.date().max('now').optional(),
    deviceUsed: Joi.string().max(100).allow('')
});

// Get patient profile
router.get('/profile', requirePatient, async (req, res) => {
    try {
        const patient = await db.query(`
            SELECT p.*, u.email, u.email_verified, u.created_at as registration_date
            FROM patients p
            JOIN users u ON p.user_id = u.id
            WHERE p.user_id = ?
        `, [req.user.id]);

        if (!patient.length) {
            return res.status(404).json({
                error: 'Patient profile not found'
            });
        }

        res.json({
            profile: patient[0]
        });

    } catch (error) {
        console.error('Get patient profile error:', error);
        res.status(500).json({
            error: 'Failed to fetch profile'
        });
    }
});

// Update patient profile
router.put('/profile', requirePatient, async (req, res) => {
    try {
        const { error, value } = updateProfileSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                error: 'Validation failed',
                details: error.details[0].message
            });
        }

        // Get current patient data for audit
        const currentPatient = await db.findOne('patients', { user_id: req.user.id });
        if (!currentPatient) {
            return res.status(404).json({
                error: 'Patient profile not found'
            });
        }

        // Update patient profile
        await db.update('patients', value, { user_id: req.user.id });

        // Log audit
        await db.logAudit(
            req.user.id,
            req.user.userType,
            'UPDATE_PROFILE',
            'patient',
            currentPatient.id,
            currentPatient,
            value,
            req.ip,
            req.get('User-Agent')
        );

        // Get updated profile
        const updatedPatient = await db.query(`
            SELECT p.*, u.email, u.email_verified
            FROM patients p
            JOIN users u ON p.user_id = u.id
            WHERE p.user_id = ?
        `, [req.user.id]);

        res.json({
            message: 'Profile updated successfully',
            profile: updatedPatient[0]
        });

    } catch (error) {
        console.error('Update patient profile error:', error);
        res.status(500).json({
            error: 'Failed to update profile'
        });
    }
});

// Get medical records
router.get('/medical-records', requirePatient, async (req, res) => {
    try {
        const patient = await db.findOne('patients', { user_id: req.user.id });
        if (!patient) {
            return res.status(404).json({
                error: 'Patient not found'
            });
        }

        const records = await db.query(`
            SELECT 
                mr.*,
                d.name as doctor_name,
                d.specialty as doctor_specialty
            FROM medical_records mr
            JOIN doctors d ON mr.doctor_id = d.id
            WHERE mr.patient_id = ?
            ORDER BY mr.consultation_date DESC
        `, [patient.id]);

        res.json({
            records
        });

    } catch (error) {
        console.error('Get medical records error:', error);
        res.status(500).json({
            error: 'Failed to fetch medical records'
        });
    }
});

// Get specific medical record
router.get('/medical-records/:recordId', requirePatient, async (req, res) => {
    try {
        const patient = await db.findOne('patients', { user_id: req.user.id });
        if (!patient) {
            return res.status(404).json({
                error: 'Patient not found'
            });
        }

        const record = await db.query(`
            SELECT 
                mr.*,
                d.name as doctor_name,
                d.specialty as doctor_specialty,
                d.license_number as doctor_license
            FROM medical_records mr
            JOIN doctors d ON mr.doctor_id = d.id
            WHERE mr.id = ? AND mr.patient_id = ?
        `, [req.params.recordId, patient.id]);

        if (!record.length) {
            return res.status(404).json({
                error: 'Medical record not found'
            });
        }

        // Get associated prescriptions
        const prescriptions = await db.query(`
            SELECT * FROM prescriptions
            WHERE medical_record_id = ?
            ORDER BY prescribed_date DESC
        `, [req.params.recordId]);

        res.json({
            record: {
                ...record[0],
                prescriptions
            }
        });

    } catch (error) {
        console.error('Get medical record error:', error);
        res.status(500).json({
            error: 'Failed to fetch medical record'
        });
    }
});

// Get prescriptions
router.get('/prescriptions', requirePatient, async (req, res) => {
    try {
        const patient = await db.findOne('patients', { user_id: req.user.id });
        if (!patient) {
            return res.status(404).json({
                error: 'Patient not found'
            });
        }

        const { status, limit = 20, offset = 0 } = req.query;

        let whereClause = 'WHERE p.patient_id = ?';
        let params = [patient.id];

        if (status) {
            whereClause += ' AND p.status = ?';
            params.push(status);
        }

        const prescriptions = await db.query(`
            SELECT 
                p.*,
                d.name as doctor_name,
                d.specialty as doctor_specialty
            FROM prescriptions p
            JOIN doctors d ON p.doctor_id = d.id
            ${whereClause}
            ORDER BY p.prescribed_date DESC
            LIMIT ? OFFSET ?
        `, [...params, parseInt(limit), parseInt(offset)]);

        res.json({
            prescriptions
        });

    } catch (error) {
        console.error('Get prescriptions error:', error);
        res.status(500).json({
            error: 'Failed to fetch prescriptions'
        });
    }
});

// Get appointments
router.get('/appointments', requirePatient, async (req, res) => {
    try {
        const patient = await db.findOne('patients', { user_id: req.user.id });
        if (!patient) {
            return res.status(404).json({
                error: 'Patient not found'
            });
        }

        const { status, upcoming = false } = req.query;

        let whereClause = 'WHERE a.patient_id = ?';
        let params = [patient.id];

        if (status) {
            whereClause += ' AND a.status = ?';
            params.push(status);
        }

        if (upcoming === 'true') {
            whereClause += ' AND a.appointment_date >= CURDATE()';
        }

        const appointments = await db.query(`
            SELECT 
                a.*,
                d.name as doctor_name,
                d.specialty as doctor_specialty,
                d.consultation_fee
            FROM appointments a
            JOIN doctors d ON a.doctor_id = d.id
            ${whereClause}
            ORDER BY a.appointment_date DESC, a.appointment_time DESC
        `, params);

        res.json({
            appointments
        });

    } catch (error) {
        console.error('Get appointments error:', error);
        res.status(500).json({
            error: 'Failed to fetch appointments'
        });
    }
});

// Add health metric
router.post('/health-metrics', requirePatient, async (req, res) => {
    try {
        const { error, value } = addHealthMetricSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                error: 'Validation failed',
                details: error.details[0].message
            });
        }

        const patient = await db.findOne('patients', { user_id: req.user.id });
        if (!patient) {
            return res.status(404).json({
                error: 'Patient not found'
            });
        }

        const metricId = `HM_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        const metricData = {
            id: metricId,
            patient_id: patient.id,
            recorded_by: 'self',
            ...value,
            measurement_date: value.measurementDate || new Date()
        };

        // Check for critical values and set alerts
        if (value.metricType === 'blood_pressure') {
            const systolic = value.systolic;
            const diastolic = value.diastolic;
            
            // Critical BP ranges: >180/120 or <90/60
            if ((systolic > 180 || diastolic > 120) || (systolic < 90 || diastolic < 60)) {
                metricData.is_critical = true;
            }
        }

        await db.insert('health_metrics', metricData);

        // Log audit
        await db.logAudit(
            req.user.id,
            req.user.userType,
            'ADD_HEALTH_METRIC',
            'health_metric',
            metricId,
            null,
            metricData,
            req.ip,
            req.get('User-Agent')
        );

        res.status(201).json({
            message: 'Health metric added successfully',
            metric: metricData
        });

    } catch (error) {
        console.error('Add health metric error:', error);
        res.status(500).json({
            error: 'Failed to add health metric'
        });
    }
});

// Get health metrics
router.get('/health-metrics', requirePatient, async (req, res) => {
    try {
        const patient = await db.findOne('patients', { user_id: req.user.id });
        if (!patient) {
            return res.status(404).json({
                error: 'Patient not found'
            });
        }

        const { metricType, startDate, endDate, limit = 100 } = req.query;

        let whereClause = 'WHERE patient_id = ?';
        let params = [patient.id];

        if (metricType) {
            whereClause += ' AND metric_type = ?';
            params.push(metricType);
        }

        if (startDate) {
            whereClause += ' AND measurement_date >= ?';
            params.push(startDate);
        }

        if (endDate) {
            whereClause += ' AND measurement_date <= ?';
            params.push(endDate);
        }

        const metrics = await db.query(`
            SELECT * FROM health_metrics
            ${whereClause}
            ORDER BY measurement_date DESC
            LIMIT ?
        `, [...params, parseInt(limit)]);

        res.json({
            metrics
        });

    } catch (error) {
        console.error('Get health metrics error:', error);
        res.status(500).json({
            error: 'Failed to fetch health metrics'
        });
    }
});

// Get dashboard stats
router.get('/dashboard/stats', requirePatient, async (req, res) => {
    try {
        const patient = await db.findOne('patients', { user_id: req.user.id });
        if (!patient) {
            return res.status(404).json({
                error: 'Patient not found'
            });
        }

        // Get various counts
        const [
            consultationCount,
            prescriptionCount,
            appointmentCount,
            documentCount
        ] = await Promise.all([
            db.query('SELECT COUNT(*) as count FROM medical_records WHERE patient_id = ?', [patient.id]),
            db.query('SELECT COUNT(*) as count FROM prescriptions WHERE patient_id = ? AND status = "active"', [patient.id]),
            db.query('SELECT COUNT(*) as count FROM appointments WHERE patient_id = ? AND appointment_date >= CURDATE() AND status = "scheduled"', [patient.id]),
            db.query('SELECT COUNT(*) as count FROM documents WHERE patient_id = ?', [patient.id])
        ]);

        // Get next appointment
        const nextAppointment = await db.query(`
            SELECT a.*, d.name as doctor_name
            FROM appointments a
            JOIN doctors d ON a.doctor_id = d.id
            WHERE a.patient_id = ? AND a.appointment_date >= CURDATE() AND a.status = 'scheduled'
            ORDER BY a.appointment_date ASC, a.appointment_time ASC
            LIMIT 1
        `, [patient.id]);

        // Get recent health metrics
        const recentMetrics = await db.query(`
            SELECT metric_type, value, unit, measurement_date
            FROM health_metrics
            WHERE patient_id = ?
            ORDER BY measurement_date DESC
            LIMIT 5
        `, [patient.id]);

        res.json({
            stats: {
                totalConsultations: consultationCount[0].count,
                activePrescriptions: prescriptionCount[0].count,
                upcomingAppointments: appointmentCount[0].count,
                totalDocuments: documentCount[0].count,
                nextAppointment: nextAppointment[0] || null,
                recentMetrics
            }
        });

    } catch (error) {
        console.error('Get dashboard stats error:', error);
        res.status(500).json({
            error: 'Failed to fetch dashboard stats'
        });
    }
});

// Get patient documents
router.get('/documents', requirePatient, async (req, res) => {
    try {
        const patient = await db.findOne('patients', { user_id: req.user.id });
        if (!patient) {
            return res.status(404).json({
                error: 'Patient not found'
            });
        }

        const { documentType, limit = 50, offset = 0 } = req.query;

        let whereClause = 'WHERE patient_id = ? AND is_archived = FALSE';
        let params = [patient.id];

        if (documentType) {
            whereClause += ' AND document_type = ?';
            params.push(documentType);
        }

        const documents = await db.query(`
            SELECT 
                d.*,
                doc.name as doctor_name
            FROM documents d
            LEFT JOIN doctors doc ON d.doctor_id = doc.id
            ${whereClause}
            ORDER BY d.upload_date DESC
            LIMIT ? OFFSET ?
        `, [...params, parseInt(limit), parseInt(offset)]);

        res.json({
            documents
        });

    } catch (error) {
        console.error('Get documents error:', error);
        res.status(500).json({
            error: 'Failed to fetch documents'
        });
    }
});

// Search doctors
router.get('/search/doctors', async (req, res) => {
    try {
        const { specialty, city, name, limit = 20, offset = 0 } = req.query;

        let whereClause = 'WHERE d.is_verified = TRUE AND d.is_available_online = TRUE';
        let params = [];

        if (specialty) {
            whereClause += ' AND (d.specialty LIKE ? OR d.sub_specialty LIKE ?)';
            params.push(`%${specialty}%`, `%${specialty}%`);
        }

        if (city) {
            whereClause += ' AND d.city LIKE ?';
            params.push(`%${city}%`);
        }

        if (name) {
            whereClause += ' AND d.name LIKE ?';
            params.push(`%${name}%`);
        }

        const doctors = await db.query(`
            SELECT 
                d.id,
                d.name,
                d.specialty,
                d.sub_specialty,
                d.experience_years,
                d.city,
                d.consultation_fee,
                d.rating,
                d.total_consultations,
                d.languages_spoken,
                d.profile_image_url
            FROM doctors d
            ${whereClause}
            ORDER BY d.rating DESC, d.total_consultations DESC
            LIMIT ? OFFSET ?
        `, [...params, parseInt(limit), parseInt(offset)]);

        res.json({
            doctors
        });

    } catch (error) {
        console.error('Search doctors error:', error);
        res.status(500).json({
            error: 'Failed to search doctors'
        });
    }
});

module.exports = router;