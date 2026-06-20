const OpenAI = require('openai');

class AIHealthService {
    constructor() {
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
        
        // Medical knowledge base for basic conditions
        this.medicalKnowledge = {
            symptoms: {
                fever: {
                    causes: ['viral infection', 'bacterial infection', 'inflammatory conditions'],
                    selfCare: ['rest', 'hydration', 'acetaminophen/ibuprofen'],
                    seekHelp: ['temperature >102°F (38.9°C)', 'persistent >3 days', 'difficulty breathing', 'severe headache']
                },
                headache: {
                    causes: ['tension', 'dehydration', 'stress', 'sinus issues'],
                    selfCare: ['rest in dark room', 'cold/warm compress', 'hydration', 'OTC pain relievers'],
                    seekHelp: ['sudden severe headache', 'headache with fever/stiff neck', 'vision changes', 'persistent worsening']
                },
                cough: {
                    causes: ['viral infection', 'allergies', 'dry air', 'acid reflux'],
                    selfCare: ['honey', 'warm liquids', 'humidifier', 'throat lozenges'],
                    seekHelp: ['coughing blood', 'persistent >2 weeks', 'difficulty breathing', 'high fever']
                },
                'stomach pain': {
                    causes: ['indigestion', 'gas', 'food intolerance', 'stress'],
                    selfCare: ['BRAT diet', 'clear fluids', 'rest', 'avoid fatty foods'],
                    seekHelp: ['severe pain', 'blood in vomit/stool', 'signs of dehydration', 'persistent vomiting']
                }
            },
            emergencyKeywords: [
                'chest pain', 'difficulty breathing', 'severe bleeding', 'loss of consciousness',
                'severe allergic reaction', 'stroke symptoms', 'heart attack', 'poisoning',
                'severe burns', 'choking', 'seizure', 'suicide', 'self harm'
            ]
        };
    }

    async generateHealthResponse(userMessage, patientHistory = null) {
        try {
            // Check for emergency keywords first
            const isEmergency = this.detectEmergency(userMessage);
            if (isEmergency) {
                return this.generateEmergencyResponse(userMessage);
            }

            // Try to get basic response from knowledge base
            const basicResponse = this.getBasicResponse(userMessage);
            if (basicResponse) {
                return basicResponse;
            }

            // Use AI for more complex queries
            return await this.getAIResponse(userMessage, patientHistory);

        } catch (error) {
            console.error('AI Health Service error:', error);
            return this.getFallbackResponse();
        }
    }

    detectEmergency(message) {
        const lowerMessage = message.toLowerCase();
        return this.medicalKnowledge.emergencyKeywords.some(keyword => 
            lowerMessage.includes(keyword)
        );
    }

    generateEmergencyResponse(message) {
        return {
            text: "⚠️ EMERGENCY ALERT ⚠️\n\nBased on your message, this may be a medical emergency. Please:\n\n🚨 Call emergency services immediately (911 or your local emergency number)\n🚨 If experiencing chest pain, difficulty breathing, or severe symptoms, do not wait\n🚨 Contact your nearest hospital emergency department\n\nThis AI assistant cannot provide emergency medical care. Your safety is the priority - seek immediate professional medical attention.",
            isEmergency: true,
            escalationRequired: true,
            confidence: 0.95,
            suggestedActions: ['call_emergency', 'visit_er']
        };
    }

    getBasicResponse(message) {
        const lowerMessage = message.toLowerCase();
        
        // Check against known symptoms
        for (const [symptom, info] of Object.entries(this.medicalKnowledge.symptoms)) {
            if (lowerMessage.includes(symptom)) {
                return {
                    text: this.formatSymptomResponse(symptom, info),
                    confidence: 0.8,
                    suggestedActions: ['monitor_symptoms', 'self_care'],
                    symptomDetected: symptom
                };
            }
        }
        
        return null;
    }

    formatSymptomResponse(symptom, info) {
        return `For ${symptom} management:\n\n` +
               `🔍 **Possible Causes:**\n• ${info.causes.join('\n• ')}\n\n` +
               `🏠 **Self-Care Recommendations:**\n• ${info.selfCare.join('\n• ')}\n\n` +
               `⚕️ **Seek Medical Attention If:**\n• ${info.seekHelp.join('\n• ')}\n\n` +
               `⚠️ **Important:** This is general guidance only. Consult a healthcare provider for personalized advice and proper diagnosis.`;
    }

    async getAIResponse(message, patientHistory) {
        try {
            const systemPrompt = `You are a helpful AI health assistant for Sehat Setu, a healthcare platform. Your role is to provide general health information and guidance, but you must NEVER attempt to diagnose or replace professional medical care.

IMPORTANT GUIDELINES:
- Always emphasize that this is general information, not medical diagnosis
- Recommend consulting healthcare providers for serious concerns
- Be empathetic but maintain professional boundaries
- If symptoms seem serious, strongly recommend immediate medical attention
- Never provide specific drug dosages or prescription advice
- Focus on general wellness, prevention, and when to seek care

Patient context: ${patientHistory ? JSON.stringify(patientHistory) : 'No previous history available'}

Respond in a caring, informative way while being clear about limitations.`;

            const response = await this.openai.chat.completions.create({
                model: 'gpt-3.5-turbo',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: message }
                ],
                max_tokens: 600,
                temperature: 0.3,
                presence_penalty: 0.1,
                frequency_penalty: 0.1
            });

            const aiResponse = response.choices[0].message.content;
            
            // Analyze the response for confidence and suggested actions
            const analysis = this.analyzeResponse(message, aiResponse);

            return {
                text: aiResponse,
                confidence: analysis.confidence,
                suggestedActions: analysis.actions,
                aiGenerated: true,
                model: 'gpt-3.5-turbo'
            };

        } catch (error) {
            console.error('OpenAI API error:', error);
            throw error;
        }
    }

    analyzeResponse(userMessage, aiResponse) {
        const lowerMessage = userMessage.toLowerCase();
        const lowerResponse = aiResponse.toLowerCase();
        
        let confidence = 0.7; // Base confidence
        let actions = ['general_advice'];

        // Adjust confidence based on response content
        if (lowerResponse.includes('see a doctor') || lowerResponse.includes('consult')) {
            confidence += 0.1;
            actions.push('consult_doctor');
        }

        if (lowerResponse.includes('emergency') || lowerResponse.includes('urgent')) {
            confidence += 0.2;
            actions = ['seek_immediate_care'];
        }

        // Check for symptom-specific keywords
        const symptomKeywords = ['pain', 'fever', 'cough', 'nausea', 'headache'];
        const mentionedSymptoms = symptomKeywords.filter(keyword => 
            lowerMessage.includes(keyword)
        );

        if (mentionedSymptoms.length > 0) {
            actions.push('track_symptoms');
        }

        return {
            confidence: Math.min(confidence, 1.0),
            actions
        };
    }

    getFallbackResponse() {
        return {
            text: "I'm experiencing technical difficulties right now. For your health concerns, I recommend:\n\n• Consulting with a healthcare provider\n• Calling your doctor's office\n• Visiting an urgent care center if symptoms are concerning\n• Calling emergency services for urgent situations\n\nI apologize for any inconvenience. Your health and safety are most important.",
            confidence: 0.5,
            suggestedActions: ['consult_doctor'],
            isError: true
        };
    }

    // Extract symptoms and medical entities from text
    extractMedicalEntities(text) {
        const lowerText = text.toLowerCase();
        const entities = {
            symptoms: [],
            bodyParts: [],
            severity: null,
            duration: null
        };

        // Common symptoms
        const symptoms = [
            'fever', 'headache', 'cough', 'nausea', 'vomiting', 'diarrhea',
            'pain', 'ache', 'sore', 'burning', 'itching', 'swelling',
            'dizziness', 'fatigue', 'weakness', 'shortness of breath'
        ];

        // Body parts
        const bodyParts = [
            'head', 'throat', 'chest', 'stomach', 'abdomen', 'back',
            'arm', 'leg', 'hand', 'foot', 'eye', 'ear', 'nose'
        ];

        // Severity indicators
        const severityWords = {
            mild: ['slight', 'minor', 'mild', 'little'],
            moderate: ['moderate', 'noticeable', 'bothersome'],
            severe: ['severe', 'intense', 'extreme', 'unbearable', 'terrible']
        };

        // Extract symptoms
        entities.symptoms = symptoms.filter(symptom => lowerText.includes(symptom));
        
        // Extract body parts
        entities.bodyParts = bodyParts.filter(part => lowerText.includes(part));

        // Determine severity
        for (const [level, words] of Object.entries(severityWords)) {
            if (words.some(word => lowerText.includes(word))) {
                entities.severity = level;
                break;
            }
        }

        // Extract duration (basic)
        if (lowerText.includes('days') || lowerText.includes('day')) {
            entities.duration = 'days';
        } else if (lowerText.includes('hours') || lowerText.includes('hour')) {
            entities.duration = 'hours';
        } else if (lowerText.includes('weeks') || lowerText.includes('week')) {
            entities.duration = 'weeks';
        }

        return entities;
    }

    // Generate follow-up questions based on symptoms
    generateFollowUpQuestions(entities) {
        const questions = [];

        if (entities.symptoms.includes('pain')) {
            questions.push("Can you describe the pain? Is it sharp, dull, throbbing, or burning?");
            if (!entities.severity) {
                questions.push("On a scale of 1-10, how would you rate the pain?");
            }
        }

        if (entities.symptoms.includes('fever') && !entities.duration) {
            questions.push("How long have you had the fever?");
        }

        if (entities.symptoms.length > 0 && questions.length === 0) {
            questions.push("How long have you been experiencing these symptoms?");
            questions.push("Is there anything that makes the symptoms better or worse?");
        }

        return questions.slice(0, 2); // Limit to 2 follow-up questions
    }

    // Assess if escalation to human doctor is needed
    assessEscalationNeed(message, entities) {
        const escalationTriggers = [
            'severe', 'unbearable', 'emergency', 'urgent',
            'blood', 'bleeding', 'chest pain', 'difficulty breathing',
            'loss of consciousness', 'severe allergic reaction'
        ];

        const lowerMessage = message.toLowerCase();
        const needsEscalation = escalationTriggers.some(trigger => 
            lowerMessage.includes(trigger)
        );

        return {
            escalate: needsEscalation || entities.severity === 'severe',
            reason: needsEscalation ? 'Potential serious condition detected' : null,
            urgency: needsEscalation ? 'high' : 'low'
        };
    }
}

module.exports = AIHealthService;