const cloudinary = require('cloudinary').v2;
const AWS = require('aws-sdk');

// Configure Cloudinary (recommended for this project)
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// Configure AWS S3 (alternative option)
const s3 = new AWS.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY,
    secretAccessKey: process.env.AWS_SECRET_KEY,
    region: process.env.AWS_REGION || 'us-east-1'
});

class CloudStorageService {
    constructor() {
        this.provider = process.env.CLOUD_PROVIDER || 'cloudinary'; // 'cloudinary' or 'aws'
    }

    async uploadFile(file, options = {}) {
        try {
            if (this.provider === 'cloudinary') {
                return await this.uploadToCloudinary(file, options);
            } else if (this.provider === 'aws') {
                return await this.uploadToS3(file, options);
            } else {
                throw new Error('Invalid cloud provider configuration');
            }
        } catch (error) {
            console.error('Cloud upload error:', error);
            throw new Error('File upload failed');
        }
    }

    async uploadToCloudinary(file, options) {
        const uploadOptions = {
            resource_type: 'auto', // Automatically detect file type
            folder: `sehat-setu/${options.patientId || 'general'}`,
            public_id: options.fileName || `${Date.now()}_${Math.random().toString(36).substring(7)}`,
            overwrite: false,
            notification_url: process.env.CLOUDINARY_WEBHOOK_URL,
            tags: [
                'sehat-setu',
                options.documentType || 'medical',
                options.patientId || 'unknown'
            ]
        };

        // Handle different file types
        if (options.documentType === 'medical' || options.documentType === 'prescription') {
            uploadOptions.transformation = [
                { quality: 'auto:good' },
                { fetch_format: 'auto' }
            ];
        }

        // Convert buffer to base64 for Cloudinary
        const base64File = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;

        const result = await cloudinary.uploader.upload(base64File, uploadOptions);

        return {
            url: result.secure_url,
            publicId: result.public_id,
            format: result.format,
            width: result.width,
            height: result.height,
            bytes: result.bytes,
            createdAt: result.created_at,
            version: result.version,
            resourceType: result.resource_type
        };
    }

    async uploadToS3(file, options) {
        const fileName = options.fileName || `${Date.now()}_${file.originalname}`;
        const bucketPath = `patients/${options.patientId || 'general'}/${fileName}`;

        const uploadParams = {
            Bucket: process.env.AWS_S3_BUCKET,
            Key: bucketPath,
            Body: file.buffer,
            ContentType: file.mimetype,
            Metadata: {
                'patient-id': options.patientId || 'unknown',
                'document-type': options.documentType || 'medical',
                'upload-date': new Date().toISOString()
            },
            ServerSideEncryption: 'AES256'
        };

        // Make file private for medical documents
        if (options.documentType === 'medical' || options.documentType === 'prescription') {
            uploadParams.ACL = 'private';
        }

        const result = await s3.upload(uploadParams).promise();

        return {
            url: result.Location,
            key: result.Key,
            bucket: result.Bucket,
            etag: result.ETag
        };
    }

    async deleteFile(publicId, options = {}) {
        try {
            if (this.provider === 'cloudinary') {
                return await this.deleteFromCloudinary(publicId, options);
            } else if (this.provider === 'aws') {
                return await this.deleteFromS3(publicId, options);
            }
        } catch (error) {
            console.error('Cloud delete error:', error);
            throw new Error('File deletion failed');
        }
    }

    async deleteFromCloudinary(publicId, options) {
        const result = await cloudinary.uploader.destroy(publicId, {
            resource_type: options.resourceType || 'image'
        });

        return result.result === 'ok';
    }

    async deleteFromS3(key, options) {
        const deleteParams = {
            Bucket: process.env.AWS_S3_BUCKET,
            Key: key
        };

        await s3.deleteObject(deleteParams).promise();
        return true;
    }

    async getFileInfo(publicId, options = {}) {
        try {
            if (this.provider === 'cloudinary') {
                return await this.getCloudinaryInfo(publicId, options);
            } else if (this.provider === 'aws') {
                return await this.getS3Info(publicId, options);
            }
        } catch (error) {
            console.error('Get file info error:', error);
            throw new Error('Failed to get file information');
        }
    }

    async getCloudinaryInfo(publicId, options) {
        const result = await cloudinary.api.resource(publicId, {
            resource_type: options.resourceType || 'image'
        });

        return {
            url: result.secure_url,
            publicId: result.public_id,
            format: result.format,
            width: result.width,
            height: result.height,
            bytes: result.bytes,
            createdAt: result.created_at
        };
    }

    async getS3Info(key, options) {
        const params = {
            Bucket: process.env.AWS_S3_BUCKET,
            Key: key
        };

        const result = await s3.headObject(params).promise();

        return {
            size: result.ContentLength,
            lastModified: result.LastModified,
            contentType: result.ContentType,
            metadata: result.Metadata
        };
    }

    async generateSignedUrl(publicId, options = {}) {
        try {
            if (this.provider === 'cloudinary') {
                return this.generateCloudinaryUrl(publicId, options);
            } else if (this.provider === 'aws') {
                return await this.generateS3Url(publicId, options);
            }
        } catch (error) {
            console.error('Generate signed URL error:', error);
            throw new Error('Failed to generate signed URL');
        }
    }

    generateCloudinaryUrl(publicId, options) {
        const transformations = [];

        // Add password protection for sensitive documents
        if (options.secure) {
            transformations.push({ flags: 'attachment' });
        }

        // Add quality optimization
        if (options.optimize) {
            transformations.push({ quality: 'auto:good', fetch_format: 'auto' });
        }

        const url = cloudinary.url(publicId, {
            resource_type: options.resourceType || 'image',
            transformation: transformations,
            secure: true,
            expires_at: options.expiresAt || Math.floor(Date.now() / 1000) + 3600, // 1 hour default
            auth_token: options.authToken
        });

        return url;
    }

    async generateS3Url(key, options) {
        const params = {
            Bucket: process.env.AWS_S3_BUCKET,
            Key: key,
            Expires: options.expiresIn || 3600, // 1 hour default
            ResponseContentDisposition: options.download ? 'attachment' : 'inline'
        };

        return s3.getSignedUrl('getObject', params);
    }

    // Helper method to validate file types for medical documents
    validateMedicalFile(file) {
        const allowedTypes = [
            'application/pdf',
            'image/jpeg',
            'image/jpg',
            'image/png',
            'image/tiff',
            'application/dicom', // Medical imaging format
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ];

        const maxSize = 50 * 1024 * 1024; // 50MB

        if (!allowedTypes.includes(file.mimetype)) {
            throw new Error(`File type ${file.mimetype} is not allowed for medical documents`);
        }

        if (file.size > maxSize) {
            throw new Error('File size exceeds 50MB limit');
        }

        return true;
    }

    // Generate thumbnail for image documents
    async generateThumbnail(publicId, options = {}) {
        if (this.provider === 'cloudinary') {
            return cloudinary.url(publicId, {
                resource_type: 'image',
                transformation: [
                    { width: options.width || 300, height: options.height || 300, crop: 'fit' },
                    { quality: 'auto:low' },
                    { format: 'jpg' }
                ],
                secure: true
            });
        }

        // For AWS, you would need to implement thumbnail generation
        // using AWS Lambda with Sharp or similar image processing library
        return null;
    }

    // Bulk upload for multiple files
    async bulkUpload(files, options = {}) {
        const uploadPromises = files.map(file => this.uploadFile(file, {
            ...options,
            fileName: `bulk_${Date.now()}_${file.originalname}`
        }));

        try {
            const results = await Promise.all(uploadPromises);
            return {
                success: true,
                uploaded: results,
                count: results.length
            };
        } catch (error) {
            console.error('Bulk upload error:', error);
            throw new Error('Bulk upload failed');
        }
    }

    // Archive old documents (move to different folder/bucket)
    async archiveDocument(publicId, options = {}) {
        if (this.provider === 'cloudinary') {
            // Move to archive folder
            const result = await cloudinary.uploader.rename(
                publicId,
                publicId.replace('/patients/', '/archive/patients/'),
                { resource_type: options.resourceType || 'image' }
            );
            return result;
        }

        // For AWS S3, copy to archive bucket and delete original
        if (this.provider === 'aws') {
            const copyParams = {
                Bucket: process.env.AWS_S3_ARCHIVE_BUCKET || process.env.AWS_S3_BUCKET,
                CopySource: `${process.env.AWS_S3_BUCKET}/${publicId}`,
                Key: `archive/${publicId}`,
                MetadataDirective: 'COPY'
            };

            await s3.copyObject(copyParams).promise();
            await this.deleteFromS3(publicId);
            return true;
        }
    }
}

module.exports = CloudStorageService;