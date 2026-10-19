// config/firebaseConfig.js
// Single source of truth for Firebase Admin initialization

const admin = require("firebase-admin");

const isProduction = process.env.NODE_ENV === 'production' || !!process.env.K_SERVICE;
const isEmulator = !!process.env.FIRESTORE_EMULATOR_HOST || !!process.env.FIREBASE_AUTH_EMULATOR_HOST;

let db = null;

// Initialize Firebase Admin only once
if (!admin.apps.length) {
    try {
        if (isEmulator) {
            // Local Firebase Emulator Suite
            process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8086';
            process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
            admin.initializeApp({ projectId: process.env.GCS_PROJECT_ID || 'ai-peer' });
            const { getFirestore } = require('firebase-admin/firestore');
            db = getFirestore('ai-peer');
            console.log(`[FIREBASE] Connected to Local Firebase Emulator Suite (Firestore: ${process.env.FIRESTORE_EMULATOR_HOST})`);
        } else if (process.env.GCS_PRIVATE_KEY) {
            // Local development with GCP credentials
            admin.initializeApp({
                credential: admin.credential.cert({
                    projectId: process.env.GCS_PROJECT_ID,
                    clientEmail: process.env.GCS_CLIENT_EMAIL,
                    privateKey: process.env.GCS_PRIVATE_KEY.replace(/\\n/g, '\n')
                })
            });
            const { getFirestore } = require('firebase-admin/firestore');
            db = getFirestore('ai-peer');
        } else if (isProduction) {
            // Cloud Run - uses Application Default Credentials
            admin.initializeApp();
            const { getFirestore } = require('firebase-admin/firestore');
            db = getFirestore('ai-peer');
        } else {
            // Zero-Credential Local Development Mock Mode
            console.log('[FIREBASE] Running in Zero-Credential Local Mock Mode (In-Memory Database)');
            db = createMockFirestore();
        }
    } catch (error) {
        if (process.env.NODE_ENV === 'test') {
            console.warn('[CI] Firebase init skipped:', error.message);
        } else if (!isProduction) {
            console.warn('[DEV] Falling back to in-memory mock Firestore:', error.message);
            db = createMockFirestore();
        } else {
            throw error;
        }
    }
}

/**
 * Creates an in-memory Firestore emulator for zero-credential local development.
 * Pre-seeds realistic patient data (John Senior, +15555555555) and workout activities.
 */
function createMockFirestore() {
    const store = new Map();

    const getCol = (colName) => {
        if (!store.has(colName)) store.set(colName, new Map());
        return store.get(colName);
    };

    // Pre-seed test patient John Senior (both 11-digit and 10-digit formats)
    const usersCol = getCol('users');
    const johnSeniorRecord = {
        phoneNumber: '15555555555',
        phoneVerified: true,
        name: 'John Senior',
        age: 72,
        btrack_score: 28.4,
        fear_falling_score: 21,
        createdAt: new Date().toISOString()
    };
    usersCol.set('mock-user-john-senior', johnSeniorRecord);
    usersCol.set('mock-user-john-senior-10', {
        ...johnSeniorRecord,
        phoneNumber: '5555555555'
    });

    // Subcollections map: "parentPath" -> Map
    const subcollections = new Map();
    const getSubCol = (parentPath, subColName) => {
        const fullKey = `${parentPath}/${subColName}`;
        if (!subcollections.has(fullKey)) subcollections.set(fullKey, new Map());
        return subcollections.get(fullKey);
    };

    // Helper to build document snapshot
    const makeDocSnap = (id, data) => ({
        id,
        exists: !!data,
        data: () => (data ? { ...data } : undefined),
        ref: {
            id,
            delete: async () => {
                // deletion logic handled in collection methods
            }
        }
    });

    // Helper to filter documents
    class MockQuery {
        constructor(docsMap, filters = [], limitCount = null, orderField = null, orderDir = 'asc') {
            this.docsMap = docsMap;
            this.filters = filters;
            this.limitCount = limitCount;
            this.orderField = orderField;
            this.orderDir = orderDir;
        }

        where(field, op, val) {
            return new MockQuery(this.docsMap, [...this.filters, { field, op, val }], this.limitCount, this.orderField, this.orderDir);
        }

        orderBy(field, dir = 'asc') {
            return new MockQuery(this.docsMap, this.filters, this.limitCount, field, dir);
        }

        limit(n) {
            return new MockQuery(this.docsMap, this.filters, n, this.orderField, this.orderDir);
        }

        async get() {
            let matches = [];
            for (const [id, doc] of this.docsMap.entries()) {
                let pass = true;
                for (const f of this.filters) {
                    const docVal = doc[f.field];
                    if (f.op === '==' && docVal !== f.val) pass = false;
                    else if (f.op === '>' && !(docVal > f.val)) pass = false;
                    else if (f.op === '<' && !(docVal < f.val)) pass = false;
                }
                if (pass) {
                    matches.push({ id, ...doc });
                }
            }

            if (this.orderField) {
                matches.sort((a, b) => {
                    let valA = a[this.orderField];
                    let valB = b[this.orderField];
                    if (valA?.toDate) valA = valA.toDate();
                    if (valB?.toDate) valB = valB.toDate();
                    if (valA instanceof Date) valA = valA.getTime();
                    if (valB instanceof Date) valB = valB.getTime();
                    if (this.orderDir === 'desc') return valB > valA ? 1 : (valB < valA ? -1 : 0);
                    return valA > valB ? 1 : (valA < valB ? -1 : 0);
                });
            }

            if (this.limitCount !== null) {
                matches = matches.slice(0, this.limitCount);
            }

            const docs = matches.map(m => {
                const { id, ...data } = m;
                return {
                    id,
                    exists: true,
                    data: () => ({ ...data }),
                    ref: {
                        id,
                        delete: async () => {
                            this.docsMap.delete(id);
                        }
                    }
                };
            });

            return {
                empty: docs.length === 0,
                size: docs.length,
                docs
            };
        }
    }

    const makeDocRef = (colMap, colName, docId) => ({
        id: docId,
        get: async () => makeDocSnap(docId, colMap.get(docId)),
        set: async (data, options = {}) => {
            if (options.merge && colMap.has(docId)) {
                colMap.set(docId, { ...colMap.get(docId), ...data });
            } else {
                colMap.set(docId, { ...data });
            }
            return { id: docId };
        },
        update: async (patch) => {
            const current = colMap.get(docId) || {};
            colMap.set(docId, { ...current, ...patch });
            return { id: docId };
        },
        delete: async () => {
            colMap.delete(docId);
        },
        collection: (subName) => {
            const subMap = getSubCol(`${colName}/${docId}`, subName);
            return makeCollectionRef(subMap, `${colName}/${docId}/${subName}`);
        }
    });

    const makeCollectionRef = (colMap, colName) => ({
        doc: (docId) => makeDocRef(colMap, colName, docId),
        add: async (data) => {
            const id = 'mock-' + Math.random().toString(36).substring(2, 10);
            colMap.set(id, { ...data });
            return makeDocRef(colMap, colName, id);
        },
        where: (field, op, val) => new MockQuery(colMap, [{ field, op, val }]),
        orderBy: (field, dir) => new MockQuery(colMap, [], null, field, dir),
        limit: (n) => new MockQuery(colMap, [], n),
        get: async () => new MockQuery(colMap).get()
    });

    return {
        collection: (colName) => {
            const colMap = getCol(colName);
            return makeCollectionRef(colMap, colName);
        }
    };
}

module.exports = { admin, db };
