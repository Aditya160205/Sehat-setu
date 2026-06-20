const express = require('express');
const { v4: uuidv4 } = require('uuid');
const Joi = require('joi');
const db = require('../config/database');
const { authenticateToken, requirePatient } = require('../middleware/auth');
const AIHealthService = require('../services/aiService');

const router = express.Router();
const aiService = new AIHealthService();

// Apply authentication to all chat routes
router.use(authenticateToken);
router.use(requirePatient);

const chatMessageSchema = Joi.object({
    message: Joi.string().min(1).max(1000).required(),
    sessionId: Joi.string().optional()
});

// Start or continue chat session
router.post('/message', async (req, res) => {
    try {
        const { error, value } = chatMessageSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                error: 'Validation failed',
                details: error.details[0].message
            });
        }

        const { message, sessionId } = value;
        
        // Get patient info
        const patient = await db.findOne('patients', { user_id: req.user.id });
        if (!patient) {
            return res.status(404).json({
                error: 'Patient not found'
            });
        }

        // Generate session ID if not provided
        const currentSessionId = sessionId || `CHAT_${Date.now()}_${uuidv4().substr(0, 8)}`;

        // Get patient medical history for context
        const patientHistory = await db.query(`
            SELECT 
                mr.diagnosis,
                mr.chief_complaint,
                mr.consultation_date
            FROM medical_records mr
            WHERE mr.patient_id = ?
            ORDER BY mr.consultation_date DESC
            LIMIT 5
        `, [patient.id]);

        // Get current medications
        const currentMedications = await db.query(`
            SELECT medication_name, dosage, frequency
            FROM prescriptions
            WHERE patient_id = ? AND status = 'active'
        `, [patient.id]);

        // Prepare patient context
        const patientContext = {
            age: patient.date_of_birth ? Math.floor((new Date() - new Date(patient.date_of_birth)) / (365.25 * 24 * 60 * 60 * 1000)) : null,
            gender: patient.gender,
            bloodGroup: patient.blood_group,
            medicalConditions: patient.medical_conditions,
            allergies: patient.allergies,
            recentDiagnoses: patientHistory.map(h => h.diagnosis),
            currentMedications: currentMedications.map(m => `${m.medication_name} ${m.dosage} ${m.frequency}`)
        };

        // Get AI response
        const aiResponse = await aiService.generateHealthResponse(message, patientContext);

        // Extract medical entities
        const entities = aiService.extractMedicalEntities(message);

        // Generate follow-up questions
        const followUpQuestions = aiService.generateFollowUpQuestions(entities);

        // Assess escalation need
        const escalation = aiService.assessEscalationNeed(message, entities);

        // Save user message
        const userMessageId = `MSG_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        await db.insert('chat_history', {
            id: userMessageId,
            patient_id: patient.id,
            session_id: currentSessionId,
            message: message,
            message_type: 'user',
            extracted_symptoms: JSON.stringify(entities),
            escalation_required: escalation.escalate,
            escalation_reason: escalation.reason,
            ip_address: req.ip,
            user_agent: req.get('User-Agent')
        });

        // Save AI response
        const botMessageId = `MSG_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        await db.insert('chat_history', {
            id: botMessageId,
            patient_id: patient.id,
            session_id: currentSessionId,
            message: aiResponse.text,
            message_type: 'bot',
            response: aiResponse.text,
            ai_model_used: aiResponse.model || 'rule-based',
            ai_confidence_score: aiResponse.confidence,
            suggested_actions: JSON.stringify(aiResponse.suggestedActions || []),
            escalation_required: aiResponse.isEmergency || false
        });

        // If escalation is needed, create notification for medical staff
        if (escalation.escalate || aiResponse.isEmergency) {
            await db.insert('notifications', {
                id: `NOTIF_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                user_id: 'ADMIN_001', // Admin user
                user_type: 'admin',
                type: 'emergency_alert',
                title: 'Patient Chat Escalation Required',
                message: `Patient ${patient.name} (${patient.id}) requires medical attention. Reason: ${escalation.reason || 'Emergency keywords detected'}`,
                data: JSON.stringify({
                    patientId: patient.id,
                    sessionId: currentSessionId,
                    message: message,
                    urgency: escalation.urgency
                }),
                priority: escalation.urgency === 'high' ? 'urgent' : 'high',
                send_email: true
            });
        }

        res.json({
            sessionId: currentSessionId,
            response: {
                text: aiResponse.text,
                confidence: aiResponse.confidence,
                suggestedActions: aiResponse.suggestedActions || [],
                followUpQuestions: followUpQuestions,
                isEmergency: aiResponse.isEmergency || false,
                escalationRequired: escalation.escalate
            },
            entities: entities
        });

    } catch (error) {
        console.error('Chat message error:', error);
        res.status(500).json({
            error: 'Failed to process message',
            message: 'Unable to generate response at this time'
        });
    }
});

// Get chat history
router.get('/history', async (req, res) => {
    try {
        const patient = await db.findOne('patients', { user_id: req.user.id });
        if (!patient) {
            return res.status(404).json({
                error: 'Patient not found'
            });
        }

        const { sessionId, limit = 50, offset = 0 } = req.query;

        let whereClause = 'WHERE patient_id = ?';
        let params = [patient.id];

        if (sessionId) {
            whereClause += ' AND session_id = ?';
            params.push(sessionId);
        }

        const chatHistory = await db.query(`
            SELECT 
                id,
                session_id,
                message,
                message_type,
                ai_confidence_score,
                timestamp,
                escalation_required
            FROM chat_history
            ${whereClause}
            ORDER BY timestamp ASC
            LIMIT ? OFFSET ?
        `, [...params, parseInt(limit), parseInt(offset)]);

        res.json({
            history: chatHistory
        });

    } catch (error) {
        console.error('Get chat history error:', error);
        res.status(500).json({
            error: 'Failed to fetch chat history'
        });
    }
});

// Get chat sessions
router.get('/sessions', async (req, res) => {
    try {
        const patient = await db.findOne('patients', { user_id: req.user.id });
        if (!patient) {
            return res.status(404).json({
                error: 'Patient not found'
            });
        }

        const sessions = await db.query(`
            SELECT 
                session_id,
                MIN(timestamp) as started_at,
                MAX(timestamp) as last_message_at,
                COUNT(*) as message_count,
                MAX(CASE WHEN escalation_required = 1 THEN 1 ELSE 0 END) as has_escalation
            FROM chat_history
            WHERE patient_id = ?
            GROUP BY session_id
            ORDER BY last_message_at DESC
        `, [patient.id]);

        res.json({
            sessions
        });

    } catch (error) {
        console.error('Get chat sessions error:', error);
        res.status(500).json({
            error: 'Failed to fetch chat sessions'
        });
    }
});

// Clear chat session
router.delete('/sessions/:sessionId', async (req, res) => {
    try {
        const patient = await db.findOne('patients', { user_id: req.user.id });
        if (!patient) {
            return res.status(404).json({
                error: 'Patient not found'
            });
        }

        const { sessionId } = req.params;

        // Verify session belongs to patient
        const sessionExists = await db.query(`
            SELECT 1 FROM chat_history
            WHERE patient_id = ? AND session_id = ?
            LIMIT 1
        `, [patient.id, sessionId]);

        if (!sessionExists.length) {
            return res.status(404).json({
                error: 'Chat session not found'
            });
        }

        // Delete chat history for session
        await db.query(`
            DELETE FROM chat_history
            WHERE patient_id = ? AND session_id = ?
        `, [patient.id, sessionId]);

        // Log audit
        await db.logAudit(
            req.user.id,
            req.user.userType,
            'DELETE_CHAT_SESSION',
            'chat_session',
            sessionId,
            null,
            null,
            req.ip,
            req.get('User-Agent')
        );

        res.json({
            message: 'Chat session deleted successfully'
        });

    } catch (error) {
        console.error('Delete chat session error:', error);
        res.status(500).json({
            error: 'Failed to delete chat session'
        });
    }
});

// Export chat history
router.get('/export', async (req, res) => {
    try {
        const patient = await db.findOne('patients', { user_id: req.user.id });
        if (!patient) {
            return res.status(404).json({
                error: 'Patient not found'
            });
        }

        const { sessionId, format = 'json' } = req.query;

        let whereClause = 'WHERE ch.patient_id = ?';
        let params = [patient.id];

        if (sessionId) {
            whereClause += ' AND ch.session_id = ?';
            params.push(sessionId);
        }

        const chatHistory = await db.query(`
            SELECT 
                ch.*,
                p.name as patient_name
            FROM chat_history ch
            JOIN patients p ON ch.patient_id = p.id
            ${whereClause}
            ORDER BY ch.timestamp ASC
        `, params);

        const exportData = {
            patient: {
                id: patient.id,
                name: patient.name,
                email: req.user.email
            },
            exportDate: new Date().toISOString(),
            chatHistory: chatHistory
        };

        if (format === 'json') {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename="chat-history-${patient.id}-${new Date().toISOString().split('T')[0]}.json"`);
            res.json(exportData);
        } else if (format === 'txt') {
            let textOutput = `Sehat Setu Chat History Export\n`;
            textOutput += `Patient: ${patient.name} (${patient.id})\n`;
            textOutput += `Export Date: ${new Date().toLocaleDateString()}\n`;
            textOutput += `\n${'='.repeat(50)}\n\n`;

            chatHistory.forEach(chat => {
                textOutput += `[${new Date(chat.timestamp).toLocaleString()}] `;
                textOutput += chat.message_type === 'user' ? 'You: ' : 'AI Assistant: ';
                textOutput += `${chat.message}\n\n`;
            });

            res.setHeader('Content-Type', 'text/plain');
            res.setHeader('Content-Disposition', `attachment; filename="chat-history-${patient.id}-${new Date().toISOString().split('T')[0]}.txt"`);
            res.send(textOutput);
        } else {
            return res.status(400).json({
                error: 'Invalid format. Supported formats: json, txt'
            });
        }

        // Log audit
        await db.logAudit(
            req.user.id,
            req.user.userType,
            'EXPORT_CHAT_HISTORY',
            'chat_history',
            sessionId || 'all',
            null,
            { format },
            req.ip,
            req.get('User-Agent')
        );

    } catch (error) {
        console.error('Export chat history error:', error);
        res.status(500).json({
            error: 'Failed to export chat history'
        });
    }
});

// Get health suggestions based on chat analysis
router.get('/suggestions', async (req, res) => {
    try {
        const patient = await db.findOne('patients', { user_id: req.user.id });
        if (!patient) {
            return res.status(404).json({
                error: 'Patient not found'
            });
        }

        // Get recent chat messages to analyze patterns
        const recentChats = await db.query(`
            SELECT message, extracted_symptoms, timestamp
            FROM chat_history
            WHERE patient_id = ? AND message_type = 'user'
            AND timestamp >= DATE_SUB(NOW(), INTERVAL 30 DAY)
            ORDER BY timestamp DESC
            LIMIT 20
        `, [patient.id]);

        // Analyze common symptoms and patterns
        const symptomFrequency = {};
        recentChats.forEach(chat => {
            if (chat.extracted_symptoms) {
                try {
                    const symptoms = JSON.parse(chat.extracted_symptoms);
                    if (symptoms.symptoms) {
                        symptoms.symptoms.forEach(symptom => {
                            symptomFrequency[symptom] = (symptomFrequency[symptom] || 0) + 1;
                        });
                    }
                } catch (e) {
                    // Ignore parsing errors
                }
            }
        });

        // Generate suggestions based on patterns
        const suggestions = [];

        // Frequent symptom suggestions
        Object.entries(symptomFrequency).forEach(([symptom, frequency]) => {
            if (frequency >= 3) {
                suggestions.push({
                    type: 'symptom_tracking',
                    title: `Track Your ${symptom}`,
                    description: `You've mentioned ${symptom} ${frequency} times recently. Consider keeping a symptom diary.`,
                    priority: 'medium',
                    actionUrl: '/health-metrics'
                });
            }
        });

        // General health suggestions
        suggestions.push(
            {
                type: 'health_checkup',
                title: 'Schedule Regular Checkup',
                description: 'Regular health checkups help prevent issues and maintain good health.',
                priority: 'low',
                actionUrl: '/appointments'
            },
            {
                type: 'health_metrics',
                title: 'Track Your Vitals',
                description: 'Regular monitoring of blood pressure, weight, and other metrics provides valuable health insights.',
                priority: 'medium',
                actionUrl: '/health-metrics'
            }
        );

        res.json({
            suggestions: suggestions.slice(0, 5) // Limit to 5 suggestions
        });

    } catch (error) {
        console.error('Get suggestions error:', error);
        res.status(500).json({
            error: 'Failed to generate suggestions'
        });
    }
});

module.exports = router;