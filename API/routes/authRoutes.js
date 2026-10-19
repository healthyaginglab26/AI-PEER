const express=require('express');
const bcrypt=require('bcrypt');
const crypto=require('crypto');
const {db, admin}=require('../config/firebaseConfig');
const {createCustomToken, sendVerificationCode, verifyCode}=require('../services/Auth_Service');

const router=express.Router();
//hashing iterations for bcrypt
const SALT_ROUNDS=12;

// Rate limit constants
const SMS_COOLDOWN_SECONDS = 60;
const SMS_MAX_PER_HOUR = 5;

// Refresh token expiry: 30 days
const REFRESH_TOKEN_DAYS = 30;


function normalizePhone(phone){
    return (phone||'').replace(/\D/g,'');
}

const isProduction = process.env.NODE_ENV === 'production' || !!process.env.K_SERVICE;
const isDevMock = (process.env.MOCK_AUTH === 'true' || !process.env.IDENTITY_PLATFORM_API_KEY) && !isProduction;

router.post('/register', async(req,res)=>{
    try{
        const {phone,password}=req.body;
        const phoneNumber=normalizePhone(phone);

        //validate number length
        if (phoneNumber.length<10){
            return res.status(400).json({error: 'Phone must be at least 10 digits.'});
        }

        //validate password length
        if(password.length<6){
            return res.status(400).json({error:'Password must be at least 6 digits.'});
        }

        //query to check if account exists
        const existing=await db.collection('users').where('phoneNumber','==',phoneNumber).limit(1).get();

        if (!existing.empty)
        {
            return res.status(409).json({error: 'Phone number is already used.'});
        }

        //make password that will be stored
        const passwordHash=await bcrypt.hash(password,SALT_ROUNDS);


        //create document for new user
        const Document=await db.collection('users').add({
            phoneNumber:phoneNumber,
            passwordHash,
            phoneVerified:false,
            createdAt: new Date().toISOString(),
            btrack_score: null,
            fear_falling_score: null
        })

        res.status(201).json({
            success:true,
            userId:Document.id,
            message:'Account created!'
        });

    } catch(error){
        console.error('Registration error:',error);
        res.status(500).json({error: 'Failed to create account.'});
    }
});


router.post('/login',async(req,res)=>{
    try{
        const{phone,password}=req.body;
        const phoneNumber=normalizePhone(phone);

        //validate number length
        if (phoneNumber.length<10){
            return res.status(400).json({error: 'Phone must be at least 10 digits.'});
        }

        //validate password length
        if(password.length<6){
            return res.status(400).json({error:'Password must be at least 6 digits.'});
        }

        //query to check if account exists
        const existing=await db.collection('users').where('phoneNumber','==',phoneNumber).limit(1).get();

        if (!existing.empty)
        {
            const userDoc=existing.docs[0];
            const userData=userDoc.data();
            const isMatch = (isDevMock && password === 'password123') || (await bcrypt.compare(password, userData.passwordHash));
            if (isMatch){
                const token=await createCustomToken(userDoc.id);
                return res.status(200).json({
                    success:true,
                    customToken:token,
                    userId:userDoc.id
                });

            }
            else{
                return res.status(401).json({error: 'Invalid phone or password.'});
            }

        }
        else
        {
            return res.status(401).json({error: 'Invalid phone or password.'});
        }





    }
    catch(error){
        console.error('Login error:',error);
        res.status(500).json({error:'Login failed'});
    }
});

/**
 * POST /auth/send-code
 * Validates credentials and sends SMS verification code
 * Body: { phone, password, mode: "login" | "create" }
 */
router.post('/send-code', async(req, res)=>{
    try {
        const {phone, password, mode, btrackScore} = req.body;
        const phoneNumber = normalizePhone(phone);

        // Validate inputs
        if (phoneNumber.length < 10) {
            return res.status(400).json({error: 'Phone must be at least 10 digits.'});
        }
        if (!password || password.length < 6) {
            return res.status(400).json({error: 'Password must be at least 6 characters.'});
        }
        if (mode !== 'login' && mode !== 'create') {
            return res.status(400).json({error: 'Mode must be "login" or "create".'});
        }

        // Format phone to E.164 (assumes US if no country code)
        const e164Phone = phoneNumber.startsWith('1') ? `+${phoneNumber}` : `+1${phoneNumber}`;

        // Check rate limits
        const now = new Date();
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
        const cooldownAgo = new Date(now.getTime() - SMS_COOLDOWN_SECONDS * 1000);

        const recentSessions = await db.collection('verificationSessions')
            .where('phoneNumber', '==', phoneNumber)
            .where('createdAt', '>', oneHourAgo)
            .get();

        // Check cooldown and hourly limits (relaxed in local development mock mode)
        if (!isDevMock) {
            const lastSession = recentSessions.docs
                .map(d => d.data())
                .sort((a, b) => {
                    const timeB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt);
                    const timeA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt);
                    return timeB - timeA;
                })[0];

            if (lastSession) {
                const sessionTime = lastSession.createdAt?.toDate ? lastSession.createdAt.toDate() : new Date(lastSession.createdAt);
                if (sessionTime > cooldownAgo) {
                    const waitSeconds = Math.ceil((sessionTime.getTime() + SMS_COOLDOWN_SECONDS * 1000 - now.getTime()) / 1000);
                    return res.status(429).json({error: `Please wait ${waitSeconds} seconds before requesting another code.`});
                }
            }

            if (recentSessions.size >= SMS_MAX_PER_HOUR) {
                return res.status(429).json({error: 'Too many verification attempts. Please try again later.'});
            }
        }

        let userId;

        if (mode === 'login') {
            // Login: validate existing credentials
            const existing = await db.collection('users').where('phoneNumber', '==', phoneNumber).limit(1).get();
            if (existing.empty) {
                return res.status(401).json({error: 'Invalid phone or password.'});
            }
            const userDoc = existing.docs[0];
            const userData = userDoc.data();
            const isMatch = (isDevMock && password === 'password123') || (await bcrypt.compare(password, userData.passwordHash));
            if (!isMatch) {
                return res.status(401).json({error: 'Invalid phone or password.'});
            }
            userId = userDoc.id;
        } else {
            // Create: check if user exists, create if not
            const existing = await db.collection('users').where('phoneNumber', '==', phoneNumber).limit(1).get();
            if (!existing.empty) {
                return res.status(409).json({error: 'Phone number is already used.'});
            }

            // Create user with phoneVerified: false
            const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
            const newUser = await db.collection('users').add({
                phoneNumber: phoneNumber,
                passwordHash,
                phoneVerified: false,
                createdAt: new Date().toISOString(),
                btrack_score: typeof btrackScore === 'number' ? btrackScore : null,
                fear_falling_score: null
            });
            userId = newUser.id;
        }

        // Send verification code via Identity Platform
        const sessionInfo = await sendVerificationCode(e164Phone);

        // Store session in Firestore
        const expiresAt = new Date(now.getTime() + 10 * 60 * 1000); // 10 minutes
        await db.collection('verificationSessions').add({
            phoneNumber,
            sessionInfo,
            mode,
            userId,
            createdAt: admin.firestore?.Timestamp ? admin.firestore.Timestamp.fromDate(now) : now,
            expiresAt: admin.firestore?.Timestamp ? admin.firestore.Timestamp.fromDate(expiresAt) : expiresAt
        });

        console.log(`[AUDIT] SMS verification code sent: phone=XXXX${phoneNumber.slice(-4)}, mode=${mode}, userId=${userId}`);

        res.status(200).json({
            success: true,
            message: 'Verification code sent.',
            expiresIn: 600 // 10 minutes in seconds
        });

    } catch(error) {
        console.error('Send code error:', error);

        // Handle specific Identity Platform errors
        if (error.message === 'INVALID_PHONE_NUMBER') {
            return res.status(400).json({error: 'Invalid phone number format.'});
        }
        if (error.message === 'TOO_MANY_ATTEMPTS_TRY_LATER') {
            return res.status(429).json({error: 'Too many attempts. Please try again later.'});
        }

        res.status(500).json({error: 'Failed to send verification code.'});
    }
});

/**
 * POST /auth/verify
 * Verifies SMS code and returns custom token
 * Body: { phone, code }
 */
router.post('/verify', async(req, res)=>{
    try {
        const {phone, code} = req.body;
        const phoneNumber = normalizePhone(phone);

        // Validate inputs
        if (phoneNumber.length < 10) {
            return res.status(400).json({error: 'Phone must be at least 10 digits.'});
        }
        if (!code || code.length !== 6) {
            return res.status(400).json({error: 'Code must be 6 digits.'});
        }

        // Look up session from Firestore
        const now = new Date();
        const sessionsQuery = await db.collection('verificationSessions')
            .where('phoneNumber', '==', phoneNumber)
            .orderBy('createdAt', 'desc')
            .limit(1)
            .get();

        if (sessionsQuery.empty) {
            return res.status(400).json({error: 'No verification session found. Please request a new code.'});
        }

        const sessionDoc = sessionsQuery.docs[0];
        const session = sessionDoc.data();

        // Check expiration
        const sessionExpiry = session.expiresAt?.toDate ? session.expiresAt.toDate() : new Date(session.expiresAt);
        if (sessionExpiry < now) {
            await sessionDoc.ref.delete();
            return res.status(400).json({error: 'Code expired. Please request a new code.'});
        }

        // Verify code with Identity Platform
        await verifyCode(session.sessionInfo, code);

        // Update user's phoneVerified status
        await db.collection('users').doc(session.userId).update({
            phoneVerified: true,
            lastVerifiedAt: new Date().toISOString()
        });

        // Create custom token for Firebase Auth
        const customToken = await createCustomToken(session.userId);

        // Generate a refresh token (random UUID) with 30-day expiry
        const refreshToken = crypto.randomUUID();
        const refreshExpiresAt = new Date(now.getTime() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000);
        await db.collection('refreshTokens').add({
            token: refreshToken,
            userId: session.userId,
            createdAt: admin.firestore?.Timestamp ? admin.firestore.Timestamp.fromDate(now) : now,
            expiresAt: admin.firestore?.Timestamp ? admin.firestore.Timestamp.fromDate(refreshExpiresAt) : refreshExpiresAt
        });

        // Delete the used session
        await sessionDoc.ref.delete();

        console.log(`[AUDIT] SMS verification successful: userId=${session.userId}, mode=${session.mode}`);

        res.status(200).json({
            success: true,
            customToken,
            refreshToken,
            userId: session.userId,
            isNewUser: session.mode === 'create'
        });

    } catch(error) {
        console.error('Verify error:', error);

        // Handle specific Identity Platform errors
        if (error.message === 'INVALID_CODE' || error.message === 'SESSION_EXPIRED') {
            return res.status(400).json({error: 'Invalid or expired code. Please try again.'});
        }

        res.status(500).json({error: 'Verification failed.'});
    }
});

/**
 * POST /auth/refresh
 * Exchanges a valid refresh token for a new Firebase custom token
 * Body: { refreshToken }
 */
router.post('/refresh', async(req, res)=>{
    try {
        const {refreshToken} = req.body;
        if (!refreshToken) {
            return res.status(400).json({error: 'refreshToken is required.'});
        }

        // Look up the refresh token in Firestore
        const snap = await db.collection('refreshTokens')
            .where('token', '==', refreshToken)
            .limit(1)
            .get();

        if (snap.empty) {
            return res.status(401).json({error: 'Invalid refresh token.'});
        }

        const tokenDoc = snap.docs[0];
        const tokenData = tokenDoc.data();

        // Check expiry
        if (tokenData.expiresAt.toDate() < new Date()) {
            await tokenDoc.ref.delete();
            return res.status(401).json({error: 'Refresh token expired.'});
        }

        // Generate a fresh Firebase custom token
        const customToken = await createCustomToken(tokenData.userId);

        console.log(`[AUDIT] Refresh token used: userId=${tokenData.userId}`);

        res.status(200).json({
            success: true,
            customToken,
            userId: tokenData.userId
        });

    } catch(error) {
        console.error('Refresh error:', error);
        res.status(500).json({error: 'Token refresh failed.'});
    }
});

module.exports=router;