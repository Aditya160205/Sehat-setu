const mysql = require('mysql2');

// Database connection configuration
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'sehat_setu',
    charset: 'utf8mb4',
    timezone: '+00:00',
    multipleStatements: true,
    connectionLimit: 10,
    queueLimit: 0
};


// Create connection pool for better performance
const pool = mysql.createPool(dbConfig);

// Promisify for async/await usage
const promisePool = pool.promise();

// Test database connection
const testConnection = async () => {
    try {
        const connection = await promisePool.getConnection();
        console.log('✅ Database connected successfully');
        connection.release();
        return true;
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
        return false;
    }
};

// Execute test connection on module load
testConnection();

// Helper function for executing queries with error handling
const query = async (sql, params = []) => {
    try {
        const [results] = await promisePool.execute(sql, params);
        return results;
    } catch (error) {
        console.error('Database query error:', error);
        throw error;
    }
};

// Helper function for transactions
const transaction = async (queries) => {
    const connection = await promisePool.getConnection();
    try {
        await connection.beginTransaction();
        
        const results = [];
        for (const { sql, params } of queries) {
            const [result] = await connection.execute(sql, params);
            results.push(result);
        }
        
        await connection.commit();
        return results;
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

// Helper functions for common operations
const findById = async (table, id) => {
    const sql = `SELECT * FROM ${table} WHERE id = ?`;
    const results = await query(sql, [id]);
    return results[0] || null;
};

const findOne = async (table, conditions) => {
    const keys = Object.keys(conditions);
    const values = Object.values(conditions);
    const whereClause = keys.map(key => `${key} = ?`).join(' AND ');
    
    const sql = `SELECT * FROM ${table} WHERE ${whereClause}`;
    const results = await query(sql, values);
    return results[0] || null;
};

const findMany = async (table, conditions = {}, options = {}) => {
    let sql = `SELECT * FROM ${table}`;
    const values = [];
    
    if (Object.keys(conditions).length > 0) {
        const keys = Object.keys(conditions);
        const whereClause = keys.map(key => `${key} = ?`).join(' AND ');
        sql += ` WHERE ${whereClause}`;
        values.push(...Object.values(conditions));
    }
    
    if (options.orderBy) {
        sql += ` ORDER BY ${options.orderBy}`;
        if (options.order) {
            sql += ` ${options.order}`;
        }
    }
    
    if (options.limit) {
        sql += ` LIMIT ${options.limit}`;
        if (options.offset) {
            sql += ` OFFSET ${options.offset}`;
        }
    }
    
    return await query(sql, values);
};

const insert = async (table, data) => {
    const keys = Object.keys(data);
    const values = Object.values(data);
    const placeholders = keys.map(() => '?').join(', ');
    
    const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`;
    const result = await query(sql, values);
    return result;
};

const update = async (table, data, conditions) => {
    const dataKeys = Object.keys(data);
    const dataValues = Object.values(data);
    const conditionKeys = Object.keys(conditions);
    const conditionValues = Object.values(conditions);
    
    const setClause = dataKeys.map(key => `${key} = ?`).join(', ');
    const whereClause = conditionKeys.map(key => `${key} = ?`).join(' AND ');
    
    const sql = `UPDATE ${table} SET ${setClause} WHERE ${whereClause}`;
    const result = await query(sql, [...dataValues, ...conditionValues]);
    return result;
};

const deleteRecord = async (table, conditions) => {
    const keys = Object.keys(conditions);
    const values = Object.values(conditions);
    const whereClause = keys.map(key => `${key} = ?`).join(' AND ');
    
    const sql = `DELETE FROM ${table} WHERE ${whereClause}`;
    const result = await query(sql, values);
    return result;
};

// Audit logging function
const logAudit = async (userId, userType, action, entityType, entityId, oldValues = null, newValues = null, ipAddress = null, userAgent = null) => {
    const auditData = {
        id: 'AUDIT_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        user_id: userId,
        user_type: userType,
        action,
        entity_type: entityType,
        entity_id: entityId,
        old_values: oldValues ? JSON.stringify(oldValues) : null,
        new_values: newValues ? JSON.stringify(newValues) : null,
        ip_address: ipAddress,
        user_agent: userAgent
    };
    
    try {
        await insert('audit_logs', auditData);
    } catch (error) {
        console.error('Failed to log audit:', error);
        // Don't throw error for audit logging failures
    }
};

module.exports = {
    pool,
    promisePool,
    query,
    transaction,
    findById,
    findOne,
    findMany,
    insert,
    update,
    delete: deleteRecord,
    testConnection,
    logAudit
};