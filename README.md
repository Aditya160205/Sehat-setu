# Sehat Setu - Unified Health Records & Consultation Hub

A comprehensive healthcare platform for migrant workers in Kerala, featuring AI-powered medical assistance, secure health record management, and telemedicine consultations.

## 🚀 Live Demo

🌐 Frontend: https://sehat-setu-7w40.onrender.com/

## 🚀 Quick Start

### Backend Setup

```bash
cd backend
npm install
cp .env.example .env
# Edit .env with your MongoDB URI and JWT secrets
npm run dev
```

### Frontend Setup

1. Open VS Code in project root
2. Install "Live Server" extension
3. Right-click `frontend/index.html` → "Open with Live Server"

**For detailed setup instructions, see [SETUP_GUIDE.md](SETUP_GUIDE.md)**

## 📁 Project Structure

```
sehat-setu/
├── backend/              # Node.js + Express + MongoDB backend
│   ├── models/          # Database models (User, Patient, Doctor, Appointment)
│   ├── routes/          # API routes (auth, patients, doctors, appointments)
│   ├── middleware/      # Authentication middleware
│   ├── server.js        # Main server file
│   ├── package.json     # Backend dependencies
│   └── .env.example     # Environment variables template
├── frontend/            # HTML/CSS/JS frontend
│   ├── css/            # Stylesheets
│   ├── js/             # JavaScript files
│   ├── index.html      # Landing page
│   ├── login.html      # Login/Register page
│   ├── patient-dashboard.html
│   └── doctor-dashboard.html
├── SETUP_GUIDE.md      # Detailed setup instructions
└── README.md           # This file
```

## ✨ Features

- **User Authentication**: Secure JWT-based authentication for patients and doctors
- **Patient Management**: Complete health records, medical history, documents
- **Doctor Profiles**: Specialty, experience, availability management
- **Appointment System**: Book, manage, and track appointments
- **AI Health Assistant**: Preliminary health assessments (frontend ready)
- **Secure Document Storage**: Medical records and prescriptions
- **Multi-language Support**: Malayalam, Hindi, English
- **Mobile-First Design**: Responsive and accessible

## 🔌 API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `GET /api/auth/profile` - Get current user profile
- `POST /api/auth/refresh` - Refresh access token

### Patients
- `GET /api/patients/me` - Get patient profile
- `PUT /api/patients/me` - Update patient profile
- `POST /api/patients/me/medical-history` - Add medical history
- `POST /api/patients/me/documents` - Add document

### Doctors
- `GET /api/doctors` - Get all doctors
- `GET /api/doctors/:id` - Get doctor by ID
- `GET /api/doctors/me` - Get doctor profile
- `PUT /api/doctors/me` - Update doctor profile

### Appointments
- `POST /api/appointments` - Create appointment
- `GET /api/appointments` - Get appointments
- `GET /api/appointments/:id` - Get appointment by ID
- `PUT /api/appointments/:id` - Update appointment
- `DELETE /api/appointments/:id` - Cancel appointment

## 🛠️ Technologies

### Backend
- Node.js & Express.js
- MongoDB & Mongoose
- JWT Authentication
- bcryptjs for password hashing
- CORS enabled

### Frontend
- HTML5, CSS3, JavaScript (ES6+)
- Responsive design
- Font Awesome icons
- Google Fonts

## 🔐 Security

- Password hashing with bcryptjs
- JWT token-based authentication
- Protected routes with middleware
- CORS configuration
- Input validation
- Secure HTTP headers

## 📝 Environment Variables

Create a `.env` file in the backend directory:

```env
PORT=3000
NODE_ENV=development
MONGO_URI=mongodb://localhost:27017/sehat-setu
JWT_SECRET=your_jwt_secret_key
JWT_EXPIRE=7d
JWT_REFRESH_SECRET=your_refresh_secret_key
JWT_REFRESH_EXPIRE=30d
FRONTEND_URL=http://127.0.0.1:5500
```

## 🧪 Testing

1. Start backend: `cd backend && npm run dev`
2. Start frontend: Open with Live Server
3. Register a patient account
4. Register a doctor account
5. Test login for both user types
6. Create an appointment
7. View appointments in dashboard

## 📚 Documentation

- [Complete Setup Guide](SETUP_GUIDE.md) - Step-by-step setup instructions
- [Backend API Documentation](backend/README.md) - Detailed API documentation
- Frontend Configuration: `frontend/js/config.js`

## 🚧 Development Status

✅ **Completed:**
- User authentication (register/login)
- Patient and doctor models
- Appointment system
- Protected routes
- CORS configuration
- Frontend login/register UI
- API integration

🔄 **In Progress:**
- Dashboard implementations
- File upload functionality
- AI health assistant integration

📋 **Planned:**
- Video consultation
- Real-time notifications
- Payment integration
- Analytics dashboard

## 🤝 Contributing

This is a project for the Government of Kerala - Health Service Department.

## 📄 License

MIT License

## 👥 Support

For issues and questions:
- Check [SETUP_GUIDE.md](SETUP_GUIDE.md)
- Review [backend/README.md](backend/README.md)
- Check console logs for errors

## 🎯 SDG Alignment

This project supports UN Sustainable Development Goal 3: Good Health and Well-being, by providing accessible healthcare services to migrant workers in Kerala.
