-- Sehat Setu Database Schema
-- Healthcare Management System Database

CREATE DATABASE IF NOT EXISTS sehat_setu CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE sehat_setu;

-- Users table (authentication for both patients and doctors)
CREATE TABLE users (
    id VARCHAR(50) PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    user_type ENUM('patient', 'doctor', 'admin') NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    email_verified BOOLEAN DEFAULT FALSE,
    verification_token VARCHAR(255),
    reset_token VARCHAR(255),
    reset_token_expires TIMESTAMP NULL,
    last_login TIMESTAMP NULL,
    login_attempts INT DEFAULT 0,
    locked_until TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Patients table
CREATE TABLE patients (
    id VARCHAR(50) PRIMARY KEY,
    user_id VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    date_of_birth DATE,
    gender ENUM('male', 'female', 'other'),
    phone VARCHAR(20),
    blood_group VARCHAR(5),
    emergency_contact VARCHAR(20),
    emergency_contact_name VARCHAR(255),
    address TEXT,
    city VARCHAR(100),
    state VARCHAR(100),
    postal_code VARCHAR(20),
    country VARCHAR(100) DEFAULT 'India',
    occupation VARCHAR(100),
    medical_conditions TEXT,
    allergies TEXT,
    current_medications TEXT,
    insurance_provider VARCHAR(255),
    insurance_number VARCHAR(100),
    profile_image_url VARCHAR(500),
    registration_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Doctors table
CREATE TABLE doctors (
    id VARCHAR(50) PRIMARY KEY,
    user_id VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    license_number VARCHAR(100) UNIQUE NOT NULL,
    specialty VARCHAR(100),
    sub_specialty VARCHAR(100),
    qualifications TEXT,
    experience_years INT DEFAULT 0,
    phone VARCHAR(20),
    clinic_name VARCHAR(255),
    clinic_address TEXT,
    city VARCHAR(100),
    state VARCHAR(100),
    postal_code VARCHAR(20),
    country VARCHAR(100) DEFAULT 'India',
    consultation_fee DECIMAL(10,2),
    bio TEXT,
    languages_spoken VARCHAR(255),
    awards TEXT,
    certifications TEXT,
    profile_image_url VARCHAR(500),
    is_verified BOOLEAN DEFAULT FALSE,
    verification_documents JSON,
    rating DECIMAL(3,2) DEFAULT 0.00,
    total_ratings INT DEFAULT 0,
    total_consultations INT DEFAULT 0,
    availability_schedule JSON,
    is_available_online BOOLEAN DEFAULT TRUE,
    registration_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Medical records/consultations table
CREATE TABLE medical_records (
    id VARCHAR(50) PRIMARY KEY,
    patient_id VARCHAR(50) NOT NULL,
    doctor_id VARCHAR(50) NOT NULL,
    consultation_type ENUM('online', 'in_person', 'emergency') DEFAULT 'online',
    consultation_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    chief_complaint TEXT NOT NULL,
    history_present_illness TEXT,
    past_medical_history TEXT,
    family_history TEXT,
    social_history TEXT,
    physical_examination TEXT,
    diagnosis TEXT,
    differential_diagnosis TEXT,
    treatment_plan TEXT,
    recommendations TEXT,
    follow_up_date DATE,
    notes TEXT,
    vitals JSON,
    investigation_results TEXT,
    status ENUM('scheduled', 'in_progress', 'completed', 'cancelled') DEFAULT 'completed',
    consultation_duration INT, -- in minutes
    fees_charged DECIMAL(10,2),
    payment_status ENUM('pending', 'paid', 'failed') DEFAULT 'paid',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE
);

-- Prescriptions table
CREATE TABLE prescriptions (
    id VARCHAR(50) PRIMARY KEY,
    medical_record_id VARCHAR(50),
    patient_id VARCHAR(50) NOT NULL,
    doctor_id VARCHAR(50) NOT NULL,
    medication_name VARCHAR(255) NOT NULL,
    generic_name VARCHAR(255),
    dosage VARCHAR(100) NOT NULL,
    frequency VARCHAR(100) NOT NULL,
    duration VARCHAR(100) NOT NULL,
    route VARCHAR(50), -- oral, topical, injection, etc.
    instructions TEXT,
    quantity_prescribed INT,
    refills_allowed INT DEFAULT 0,
    refills_remaining INT DEFAULT 0,
    side_effects TEXT,
    contraindications TEXT,
    prescribed_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    start_date DATE,
    end_date DATE,
    status ENUM('active', 'completed', 'discontinued', 'expired') DEFAULT 'active',
    discontinued_reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (medical_record_id) REFERENCES medical_records(id) ON DELETE SET NULL,
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE
);

-- Documents table (for cloud storage references)
CREATE TABLE documents (
    id VARCHAR(50) PRIMARY KEY,
    patient_id VARCHAR(50) NOT NULL,
    doctor_id VARCHAR(50),
    medical_record_id VARCHAR(50),
    file_name VARCHAR(255) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    file_type VARCHAR(100) NOT NULL,
    file_size BIGINT NOT NULL,
    cloud_url VARCHAR(500) NOT NULL,
    cloud_public_id VARCHAR(255),
    document_type ENUM('lab_report', 'prescription', 'x_ray', 'mri', 'ct_scan', 'ultrasound', 'ecg', 'medical_certificate', 'discharge_summary', 'other') NOT NULL,
    description TEXT,
    tags VARCHAR(500),
    is_sensitive BOOLEAN DEFAULT TRUE,
    access_permissions JSON,
    upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expiry_date DATE,
    is_archived BOOLEAN DEFAULT FALSE,
    archived_date TIMESTAMP NULL,
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE SET NULL,
    FOREIGN KEY (medical_record_id) REFERENCES medical_records(id) ON DELETE SET NULL
);

-- Chat history table (AI interactions)
CREATE TABLE chat_history (
    id VARCHAR(50) PRIMARY KEY,
    patient_id VARCHAR(50) NOT NULL,
    session_id VARCHAR(50),
    message TEXT NOT NULL,
    response TEXT,
    message_type ENUM('user', 'bot') NOT NULL,
    ai_model_used VARCHAR(100),
    ai_confidence_score DECIMAL(5,4),
    sentiment_analysis JSON,
    extracted_symptoms JSON,
    suggested_actions JSON,
    escalation_required BOOLEAN DEFAULT FALSE,
    escalation_reason TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ip_address VARCHAR(45),
    user_agent TEXT,
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
);

-- Appointments table
CREATE TABLE appointments (
    id VARCHAR(50) PRIMARY KEY,
    patient_id VARCHAR(50) NOT NULL,
    doctor_id VARCHAR(50) NOT NULL,
    appointment_date DATE NOT NULL,
    appointment_time TIME NOT NULL,
    end_time TIME,
    duration_minutes INT DEFAULT 30,
    type ENUM('consultation', 'follow_up', 'emergency', 'routine_checkup', 'second_opinion') NOT NULL,
    consultation_mode ENUM('online', 'in_person', 'phone') DEFAULT 'online',
    status ENUM('scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show', 'rescheduled') DEFAULT 'scheduled',
    priority ENUM('low', 'medium', 'high', 'urgent') DEFAULT 'medium',
    chief_complaint TEXT,
    notes TEXT,
    doctor_notes TEXT,
    cancellation_reason TEXT,
    rescheduled_from VARCHAR(50),
    fees DECIMAL(10,2),
    payment_status ENUM('pending', 'paid', 'failed', 'refunded') DEFAULT 'pending',
    payment_method VARCHAR(50),
    payment_reference VARCHAR(100),
    reminder_sent BOOLEAN DEFAULT FALSE,
    meeting_link VARCHAR(500),
    meeting_id VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
    FOREIGN KEY (rescheduled_from) REFERENCES appointments(id) ON DELETE SET NULL
);

-- Health metrics table (vitals tracking)
CREATE TABLE health_metrics (
    id VARCHAR(50) PRIMARY KEY,
    patient_id VARCHAR(50) NOT NULL,
    recorded_by VARCHAR(50), -- doctor_id or 'self' for patient-recorded
    metric_type ENUM('blood_pressure', 'heart_rate', 'temperature', 'weight', 'height', 'bmi', 'blood_sugar', 'oxygen_saturation', 'cholesterol', 'other') NOT NULL,
    value VARCHAR(100) NOT NULL,
    unit VARCHAR(20),
    systolic INT, -- for blood pressure
    diastolic INT, -- for blood pressure
    notes TEXT,
    measurement_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    device_used VARCHAR(100),
    is_critical BOOLEAN DEFAULT FALSE,
    alert_sent BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
);

-- Medications inventory (for tracking patient's current medications)
CREATE TABLE patient_medications (
    id VARCHAR(50) PRIMARY KEY,
    patient_id VARCHAR(50) NOT NULL,
    prescription_id VARCHAR(50),
    medication_name VARCHAR(255) NOT NULL,
    dosage VARCHAR(100),
    frequency VARCHAR(100),
    start_date DATE NOT NULL,
    end_date DATE,
    status ENUM('active', 'completed', 'discontinued') DEFAULT 'active',
    adherence_score DECIMAL(5,2), -- percentage
    side_effects_reported TEXT,
    effectiveness_rating INT, -- 1-5 scale
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
    FOREIGN KEY (prescription_id) REFERENCES prescriptions(id) ON DELETE SET NULL
);

-- Doctor ratings and reviews
CREATE TABLE doctor_reviews (
    id VARCHAR(50) PRIMARY KEY,
    patient_id VARCHAR(50) NOT NULL,
    doctor_id VARCHAR(50) NOT NULL,
    appointment_id VARCHAR(50),
    rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
    review_text TEXT,
    communication_rating INT CHECK (communication_rating >= 1 AND communication_rating <= 5),
    treatment_effectiveness INT CHECK (treatment_effectiveness >= 1 AND treatment_effectiveness <= 5),
    waiting_time_rating INT CHECK (waiting_time_rating >= 1 AND waiting_time_rating <= 5),
    would_recommend BOOLEAN DEFAULT TRUE,
    anonymous BOOLEAN DEFAULT FALSE,
    is_verified BOOLEAN DEFAULT FALSE,
    helpful_count INT DEFAULT 0,
    reported_count INT DEFAULT 0,
    status ENUM('active', 'hidden', 'reported', 'deleted') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
    FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE SET NULL,
    UNIQUE KEY unique_patient_appointment_review (patient_id, appointment_id)
);

-- Notifications table
CREATE TABLE notifications (
    id VARCHAR(50) PRIMARY KEY,
    user_id VARCHAR(50) NOT NULL,
    user_type ENUM('patient', 'doctor') NOT NULL,
    type ENUM('appointment_reminder', 'prescription_reminder', 'lab_result', 'payment_due', 'system_update', 'health_tip', 'emergency_alert') NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    data JSON, -- additional structured data
    is_read BOOLEAN DEFAULT FALSE,
    is_sent BOOLEAN DEFAULT FALSE,
    send_email BOOLEAN DEFAULT FALSE,
    send_sms BOOLEAN DEFAULT FALSE,
    send_push BOOLEAN DEFAULT TRUE,
    scheduled_for TIMESTAMP NULL,
    sent_at TIMESTAMP NULL,
    expires_at TIMESTAMP NULL,
    priority ENUM('low', 'medium', 'high', 'urgent') DEFAULT 'medium',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- System logs for auditing
CREATE TABLE audit_logs (
    id VARCHAR(50) PRIMARY KEY,
    user_id VARCHAR(50),
    user_type ENUM('patient', 'doctor', 'admin', 'system'),
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50),
    entity_id VARCHAR(50),
    old_values JSON,
    new_values JSON,
    ip_address VARCHAR(45),
    user_agent TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Indexes for better performance
CREATE INDEX idx_patients_user_id ON patients(user_id);
CREATE INDEX idx_doctors_user_id ON doctors(user_id);
CREATE INDEX idx_doctors_specialty ON doctors(specialty);
CREATE INDEX idx_doctors_city ON doctors(city);
CREATE INDEX idx_medical_records_patient ON medical_records(patient_id);
CREATE INDEX idx_medical_records_doctor ON medical_records(doctor_id);
CREATE INDEX idx_medical_records_date ON medical_records(consultation_date);
CREATE INDEX idx_prescriptions_patient ON prescriptions(patient_id);
CREATE INDEX idx_prescriptions_doctor ON prescriptions(doctor_id);
CREATE INDEX idx_prescriptions_status ON prescriptions(status);
CREATE INDEX idx_appointments_patient ON appointments(patient_id);
CREATE INDEX idx_appointments_doctor ON appointments(doctor_id);
CREATE INDEX idx_appointments_date ON appointments(appointment_date);
CREATE INDEX idx_appointments_status ON appointments(status);
CREATE INDEX idx_documents_patient ON documents(patient_id);
CREATE INDEX idx_chat_history_patient ON chat_history(patient_id);
CREATE INDEX idx_chat_history_session ON chat_history(session_id);
CREATE INDEX idx_health_metrics_patient ON health_metrics(patient_id);
CREATE INDEX idx_health_metrics_date ON health_metrics(measurement_date);
CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_type ON notifications(type);
CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_timestamp ON audit_logs(timestamp);

-- Insert default admin user (password: admin123 - change this!)
INSERT INTO users (id, email, password_hash, user_type, is_active, email_verified) VALUES 
('ADMIN_001', 'admin@sehatsetu.com', '$2a$10$rOzJJX8F8K8FnH8F8K8F8u8F8K8F8K8F8K8F8K8F8K8F8K8F8K8F8', 'admin', TRUE, TRUE);

-- Sample data for testing (optional)
INSERT INTO users (id, email, password_hash, user_type, is_active, email_verified) VALUES 
('USER_001', 'patient@test.com', '$2a$10$rOzJJX8F8K8FnH8F8K8F8u8F8K8F8K8F8K8F8K8F8K8F8K8F8K8F8', 'patient', TRUE, TRUE),
('USER_002', 'doctor@test.com', '$2a$10$rOzJJX8F8K8FnH8F8K8F8u8F8K8F8K8F8K8F8K8F8K8F8K8F8K8F8', 'doctor', TRUE, TRUE);

INSERT INTO patients (id, user_id, name, date_of_birth, gender, phone, blood_group, address) VALUES 
('PSS001TEST001', 'USER_001', 'Test Patient', '1990-01-01', 'male', '+91-9876543210', 'O+', 'Mumbai, Maharashtra, India');

INSERT INTO doctors (id, user_id, name, license_number, specialty, experience_years, phone, is_verified) VALUES 
('DSS001TEST001', 'USER_002', 'Dr. Test Doctor', 'MED123456', 'General Medicine', 10, '+91-9876543211', TRUE);