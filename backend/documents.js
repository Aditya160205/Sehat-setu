const express = require('express');
const multer = require('multer');
const Joi = require('joi');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const { authenticateToken, requirePatient, requirePatientAccess } = require('../middleware/auth');
const CloudStorageService = require('../services/cloudService');

const router = express.Router();
const cloudService = new CloudStorageService();

// Configure multer for file upload
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB limit
        files: 10 // Max 10 files per request
    },
    fileFilter: (req, file, cb) => {
        try {
            cloudService.validateMedicalFile(file);
            cb(null, true);
        } catch (error) {
            cb(error, false);
        }
    }
});

// Apply authentication to all document routes
router.use(authenticateToken);

// Validation schemas
const documentMetadataSchema = Joi.object({
    documentType: Joi.string().valid(
        'lab_report', 'prescription', 'x_ray', 'mri', 'ct_scan', 
        'ultrasound', 'ecg', 'medical_certificate', 'discharge_summary', 'other'
    ).required(),
    description: Joi.string().max(500).allow(''),
    tags: Joi.string().max(500).allow(''),
    isSensitive: Joi.boolean().default(true)
});

// Upload document(s)
router.post('/upload', requirePatient, upload.array('files', 10), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({
                error: 'No files provided'
            });
        }

        // Validate metadata
        const { error, value } = documentMetadataSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                error: 'Validation failed',
                details: error.details[0].message
            });
        }

        const { documentType, description, tags, isSensitive } = value;

        // Get patient info
        const patient = await db.findOne('patients', { user_id: req.user.id });
        if (!patient) {
            return res.status(404).json({
                error: 'Patient not found'
            });
        }

        const uploadedDocuments = [];
        const uploadPromises = req.files.map(async (file) => {
            try {
                // Upload to cloud storage
                const uploadResult = await cloudService.uploadFile(file, {
                    patientId: patient.id,
                    documentType: documentType,
                    fileName: `${patient.id}_${Date.now()}_${file.originalname}`
                });

                // Generate document ID
                const documentId = `DOC_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

                // Save document metadata to database
                const documentData = {
                    id: documentId,
                    patient_id: patient.id,
                    file_name: file.originalname,
                    original_name: file.originalname,
                    file_type: file.mimetype,
                    file_size: file.size,
                    cloud_url: uploadResult.url,
                    cloud_public_id: uploadResult.publicId || uploadResult.key,
                    document_type: documentType,
                    description: description || null,
                    tags: tags || null,
                    is_sensitive: isSensitive
                };

                await db.insert('documents', documentData);

                uploadedDocuments.push({
                    id: documentId,
                    fileName: file.originalname,
                    size: file.size,
                    type: file.mimetype,
                    documentType: documentType,
                    url: uploadResult.url
                });

                // Log audit
                await db.logAudit(
                    req.user.id,
                    req.user.userType,
                    'UPLOAD_DOCUMENT',
                    'document',
                    documentId,
                    null,
                    documentData,
                    req.ip,
                    req.get('User-Agent')
                );

                return documentData;

            } catch (error) {
                console.error(`Upload failed for file ${file.originalname}:`, error);
                throw error;
            }
        });

        await Promise.all(uploadPromises);

        res.status(201).json({
            message: `Successfully uploaded ${uploadedDocuments.length} document(s)`,
            documents: uploadedDocuments
        });

    } catch (error) {
        console.error('Document upload error:', error);
        res.status(500).json({
            error: 'Document upload failed',
            message: error.message || 'An error occurred during upload'
        });
    }
});

// Get patient documents
router.get('/', requirePatient, async (req, res) => {
    try {
        const patient = await db.findOne('patients', { user_id: req.user.id });
        if (!patient) {
            return res.status(404).json({
                error: 'Patient not found'
            });
        }

        const { documentType, limit = 50, offset = 0, search } = req.query;

        let whereClause = 'WHERE d.patient_id = ? AND d.is_archived = FALSE';
        let params = [patient.id];

        if (documentType) {
            whereClause += ' AND d.document_type = ?';
            params.push(documentType);
        }

        if (search) {
            whereClause += ' AND (d.file_name LIKE ? OR d.description LIKE ? OR d.tags LIKE ?)';
            const searchPattern = `%${search}%`;
            params.push(searchPattern, searchPattern, searchPattern);
        }

        const documents = await db.query(`
            SELECT 
                d.*,
                doc.name as uploaded_by_doctor
            FROM documents d
            LEFT JOIN doctors doc ON d.doctor_id = doc.id
            ${whereClause}
            ORDER BY d.upload_date DESC
            LIMIT ? OFFSET ?
        `, [...params, parseInt(limit), parseInt(offset)]);

        // Get total count
        const totalCount = await db.query(`
            SELECT COUNT(*) as count
            FROM documents d
            ${whereClause}
        `, params);

        res.json({
            documents,
            pagination: {
                total: totalCount[0].count,
                limit: parseInt(limit),
                offset: parseInt(offset),
                hasNext: totalCount[0].count > (parseInt(offset) + parseInt(limit))
            }
        });

    } catch (error) {
        console.error('Get documents error:', error);
        res.status(500).json({
            error: 'Failed to fetch documents'
        });
    }
});

// Get specific document
router.get('/:documentId', requirePatient, async (req, res) => {
    try {
        const patient = await db.findOne('patients', { user_id: req.user.id });
        if (!patient) {
            return res.status(404).json({
                error: 'Patient not found'
            });
        }

        const document = await db.query(`
            SELECT 
                d.*,
                doc.name as uploaded_by_doctor
            FROM documents d
            LEFT JOIN doctors doc ON d.doctor_id = doc.id
            WHERE d.id = ? AND d.patient_id = ? AND d.is_archived = FALSE
        `, [req.params.documentId, patient.id]);

        if (!document.length) {
            return res.status(404).json({
                error: 'Document not found'
            });
        }

        res.json({
            document: document[0]
        });

    } catch (error) {
        console.error('Get document error:', error);
        res.status(500).json({
            error: 'Failed to fetch document'
        });
    }
});

// Get document download URL
router.get('/:documentId/download', requirePatient, async (req, res) => {
    try {
        const patient = await db.findOne('patients', { user_id: req.user.id });
        if (!patient) {
            return res.status(404).json({
                error: 'Patient not found'
            });
        }

        const document = await db.query(`
            SELECT * FROM documents
            WHERE id = ? AND patient_id = ? AND is_archived = FALSE
        `, [req.params.documentId, patient.id]);

        if (!document.length) {
            return res.status(404).json({
                error: 'Document not found'
            });
        }

        const doc = document[0];

        try {
            // Generate signed URL for secure download
            const downloadUrl = await cloudService.generateSignedUrl(doc.cloud_public_id, {
                expiresIn: 3600, // 1 hour
                download: true,
                resourceType: doc.file_type.startsWith('image/') ? 'image' : 'raw'
            });

            // Log audit
            await db.logAudit(
                req.user.id,
                req.user.userType,
                'DOWNLOAD_DOCUMENT',
                'document',
                doc.id,
                null,
                null,
                req.ip,
                req.get('User-Agent')
            );

            res.json({
                downloadUrl,
                fileName: doc.file_name,
                expiresIn: 3600
            });

        } catch (error) {
            // Fallback to direct URL if signed URL generation fails
            res.json({
                downloadUrl: doc.cloud_url,
                fileName: doc.file_name
            });
        }

    } catch (error) {
        console.error('Generate download URL error:', error);
        res.status(500).json({
            error: 'Failed to generate download URL'
        });
    }
});

// Update document metadata
router.put('/:documentId', requirePatient, async (req, res) => {
    try {
        const patient = await db.findOne('patients', { user_id: req.user.id });
        if (!patient) {
            return res.status(404).json({
                error: 'Patient not found'
            });
        }

        // Validate update data
        const updateSchema = Joi.object({
            description: Joi.string().max(500).allow(''),
            tags: Joi.string().max(500).allow(''),
            documentType: Joi.string().valid(
                'lab_report', 'prescription', 'x_ray', 'mri', 'ct_scan', 
                'ultrasound', 'ecg', 'medical_certificate', 'discharge_summary', 'other'
            ).optional()
        });

        const { error, value } = updateSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                error: 'Validation failed',
                details: error.details[0].message
            });
        }

        // Check if document exists and belongs to patient
        const currentDoc = await db.query(`
            SELECT * FROM documents
            WHERE id = ? AND patient_id = ?
        `, [req.params.documentId, patient.id]);

        if (!currentDoc.length) {
            return res.status(404).json({
                error: 'Document not found'
            });
        }

        // Update document
        await db.update('documents', value, { 
            id: req.params.documentId,
            patient_id: patient.id 
        });

        // Log audit
        await db.logAudit(
            req.user.id,
            req.user.userType,
            'UPDATE_DOCUMENT',
            'document',
            req.params.documentId,
            currentDoc[0],
            value,
            req.ip,
            req.get('User-Agent')
        );

        // Get updated document
        const updatedDoc = await db.query(`
            SELECT * FROM documents
            WHERE id = ? AND patient_id = ?
        `, [req.params.documentId, patient.id]);

        res.json({
            message: 'Document updated successfully',
            document: updatedDoc[0]
        });

    } catch (error) {
        console.error('Update document error:', error);
        res.status(500).json({
            error: 'Failed to update document'
        });
    }
});

// Delete document
router.delete('/:documentId', requirePatient, async (req, res) => {
    try {
        const patient = await db.findOne('patients', { user_id: req.user.id });
        if (!patient) {
            return res.status(404).json({
                error: 'Patient not found'
            });
        }

        // Get document details
        const document = await db.query(`
            SELECT * FROM documents
            WHERE id = ? AND patient_id = ?
        `, [req.params.documentId, patient.id]);

        if (!document.length) {
            return res.status(404).json({
                error: 'Document not found'
            });
        }

        const doc = document[0];

        try {
            // Delete from cloud storage
            await cloudService.deleteFile(doc.cloud_public_id, {
                resourceType: doc.file_type.startsWith('image/') ? 'image' : 'raw'
            });
        } catch (error) {
            console.error('Cloud deletion failed:', error);
            // Continue with database deletion even if cloud deletion fails
        }

        // Delete from database
        await db.delete('documents', { 
            id: req.params.documentId,
            patient_id: patient.id 
        });

        // Log audit
        await db.logAudit(
            req.user.id,
            req.user.userType,
            'DELETE_DOCUMENT',
            'document',
            req.params.documentId,
            doc,
            null,
            req.ip,
            req.get('User-Agent')
        );

        res.json({
            message: 'Document deleted successfully'
        });

    } catch (error) {
        console.error('Delete document error:', error);
        res.status(500).json({
            error: 'Failed to delete document'
        });
    }
});

// Archive document
router.post('/:documentId/archive', requirePatient, async (req, res) => {
    try {
        const patient = await db.findOne('patients', { user_id: req.user.id });
        if (!patient) {
            return res.status(404).json({
                error: 'Patient not found'
            });
        }

        // Check if document exists
        const document = await db.query(`
            SELECT * FROM documents
            WHERE id = ? AND patient_id = ? AND is_archived = FALSE
        `, [req.params.documentId, patient.id]);

        if (!document.length) {
            return res.status(404).json({
                error: 'Document not found'
            });
        }

        // Archive document
        await db.update('documents', {
            is_archived: true,
            archived_date: new Date()
        }, { 
            id: req.params.documentId,
            patient_id: patient.id 
        });

        // Optionally move to archive folder in cloud storage
        try {
            await cloudService.archiveDocument(document[0].cloud_public_id);
        } catch (error) {
            console.error('Cloud archiving failed:', error);
            // Continue even if cloud archiving fails
        }

        // Log audit
        await db.logAudit(
            req.user.id,
            req.user.userType,
            'ARCHIVE_DOCUMENT',
            'document',
            req.params.documentId,
            null,
            null,
            req.ip,
            req.get('User-Agent')
        );

        res.json({
            message: 'Document archived successfully'
        });

    } catch (error) {
        console.error('Archive document error:', error);
        res.status(500).json({
            error: 'Failed to archive document'
        });
    }
});

// Bulk operations
router.post('/bulk/delete', requirePatient, async (req, res) => {
    try {
        const patient = await db.findOne('patients', { user_id: req.user.id });
        if (!patient) {
            return res.status(404).json({
                error: 'Patient not found'
            });
        }

        const { documentIds } = req.body;

        if (!Array.isArray(documentIds) || documentIds.length === 0) {
            return res.status(400).json({
                error: 'Document IDs array is required'
            });
        }

        if (documentIds.length > 50) {
            return res.status(400).json({
                error: 'Cannot delete more than 50 documents at once'
            });
        }

        // Get documents to delete
        const placeholders = documentIds.map(() => '?').join(',');
        const documents = await db.query(`
            SELECT * FROM documents
            WHERE id IN (${placeholders}) AND patient_id = ?
        `, [...documentIds, patient.id]);

        if (documents.length === 0) {
            return res.status(404).json({
                error: 'No documents found'
            });
        }

        // Delete from cloud storage (in parallel)
        const cloudDeletions = documents.map(doc => 
            cloudService.deleteFile(doc.cloud_public_id, {
                resourceType: doc.file_type.startsWith('image/') ? 'image' : 'raw'
            }).catch(error => {
                console.error(`Failed to delete ${doc.cloud_public_id} from cloud:`, error);
                return null;
            })
        );

        await Promise.all(cloudDeletions);

        // Delete from database
        await db.query(`
            DELETE FROM documents
            WHERE id IN (${placeholders}) AND patient_id = ?
        `, [...documentIds, patient.id]);

        // Log audit for each document
        const auditPromises = documents.map(doc =>
            db.logAudit(
                req.user.id,
                req.user.userType,
                'BULK_DELETE_DOCUMENT',
                'document',
                doc.id,
                doc,
                null,
                req.ip,
                req.get('User-Agent')
            )
        );

        await Promise.all(auditPromises);

        res.json({
            message: `Successfully deleted ${documents.length} document(s)`,
            deletedCount: documents.length
        });

    } catch (error) {
        console.error('Bulk delete documents error:', error);
        res.status(500).json({
            error: 'Failed to delete documents'
        });
    }
});

// Get document statistics
router.get('/stats/summary', requirePatient, async (req, res) => {
    try {
        const patient = await db.findOne('patients', { user_id: req.user.id });
        if (!patient) {
            return res.status(404).json({
                error: 'Patient not found'
            });
        }

        const stats = await db.query(`
            SELECT 
                COUNT(*) as total_documents,
                SUM(file_size) as total_size,
                COUNT(CASE WHEN document_type = 'lab_report' THEN 1 END) as lab_reports,
                COUNT(CASE WHEN document_type = 'prescription' THEN 1 END) as prescriptions,
                COUNT(CASE WHEN document_type = 'x_ray' THEN 1 END) as xrays,
                COUNT(CASE WHEN document_type = 'mri' THEN 1 END) as mris,
                COUNT(CASE WHEN document_type = 'other' THEN 1 END) as others,
                COUNT(CASE WHEN upload_date >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 END) as recent_uploads
            FROM documents
            WHERE patient_id = ? AND is_archived = FALSE
        `, [patient.id]);

        res.json({
            stats: stats[0]
        });

    } catch (error) {
        console.error('Get document stats error:', error);
        res.status(500).json({
            error: 'Failed to fetch document statistics'
        });
    }
});

module.exports = router;