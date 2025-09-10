import nodemailer from 'nodemailer';
import { getConfig } from './config';
import { logger } from './logger';

export interface EmailOptions {
  to: string;
  subject: string;
  text?: string;
  html?: string;
}

let transporter: nodemailer.Transporter | null = null;

const getTransporter = () => {
  if (!transporter) {
    const config = getConfig();
    
    if (!config.SMTP_HOST || !config.SMTP_USER || !config.SMTP_PASSWORD) {
      logger.warn('Email configuration incomplete, using test account');
      // For development, create a test transporter
      transporter = nodemailer.createTransport({
        host: 'ethereal.email',
        port: 587,
        auth: {
          user: 'ethereal.user@ethereal.email',
          pass: 'ethereal.pass'
        }
      });
    } else {
      transporter = nodemailer.createTransport({
        host: config.SMTP_HOST,
        port: config.SMTP_PORT || 587,
        secure: (config.SMTP_PORT || 587) === 465,
        auth: {
          user: config.SMTP_USER,
          pass: config.SMTP_PASSWORD,
        },
      });
    }

    logger.info('Email transporter configured', { 
      host: config.SMTP_HOST || 'ethereal.email',
      port: config.SMTP_PORT || 587 
    });
  }

  return transporter;
};

export const sendEmail = async (options: EmailOptions): Promise<void> => {
  const config = getConfig();
  const emailTransporter = getTransporter();
  
  try {
    const mailOptions = {
      from: config.EMAIL_FROM || 'noreply@bmad.com',
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
    };

    const result = await emailTransporter!.sendMail(mailOptions);
    
    logger.info('Email sent successfully', {
      to: options.to,
      subject: options.subject,
      messageId: result.messageId,
      preview: config.SMTP_HOST ? undefined : nodemailer.getTestMessageUrl(result)
    });
  } catch (error) {
    logger.error('Failed to send email', { 
      error,
      to: options.to,
      subject: options.subject 
    });
    throw new Error('Email sending failed');
  }
};

export const sendPasswordResetEmail = async (email: string, resetToken: string, resetLink: string): Promise<void> => {
  const subject = 'Password Reset - BMAD Platform';
  
  const text = `
Hello,

You requested a password reset for your BMAD account.

Click the following link to reset your password:
${resetLink}

This link will expire in 15 minutes.

If you didn't request this password reset, please ignore this email.

Best regards,
The BMAD Team
`;

  const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Password Reset</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #007bff; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; }
        .button { 
            display: inline-block; 
            background-color: #007bff; 
            color: white; 
            padding: 12px 24px; 
            text-decoration: none; 
            border-radius: 4px;
            margin: 20px 0;
        }
        .footer { 
            margin-top: 30px; 
            padding-top: 20px; 
            border-top: 1px solid #eee; 
            color: #666; 
            font-size: 14px; 
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Password Reset Request</h1>
        </div>
        <div class="content">
            <p>Hello,</p>
            <p>You requested a password reset for your BMAD account.</p>
            <p>Click the button below to reset your password:</p>
            <p style="text-align: center;">
                <a href="${resetLink}" class="button">Reset Password</a>
            </p>
            <p><strong>This link will expire in 15 minutes.</strong></p>
            <p>If you didn't request this password reset, please ignore this email.</p>
        </div>
        <div class="footer">
            <p>Best regards,<br>The BMAD Team</p>
            <p>If you're having trouble clicking the button, copy and paste this link into your browser:<br>
            <a href="${resetLink}">${resetLink}</a></p>
        </div>
    </div>
</body>
</html>
`;

  await sendEmail({
    to: email,
    subject,
    text,
    html,
  });
};

export const sendWelcomeEmail = async (email: string, firstName?: string): Promise<void> => {
  const name = firstName || 'there';
  const subject = 'Welcome to BMAD Platform!';
  
  const text = `
Hello ${name},

Welcome to the BMAD Platform! We're excited to have you on board.

BMAD (Business Methodology for AI Development) helps you streamline your project planning with AI-powered insights and automated documentation generation.

Getting started:
1. Complete your profile setup
2. Create your first planning session
3. Explore our AI-powered project analysis tools

If you have any questions, don't hesitate to reach out to our support team.

Best regards,
The BMAD Team
`;

  const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Welcome to BMAD</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #28a745; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; }
        .feature { 
            padding: 10px;
            margin: 10px 0;
            background-color: #f8f9fa;
            border-left: 4px solid #28a745;
        }
        .footer { 
            margin-top: 30px; 
            padding-top: 20px; 
            border-top: 1px solid #eee; 
            color: #666; 
            font-size: 14px; 
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Welcome to BMAD!</h1>
        </div>
        <div class="content">
            <p>Hello ${name},</p>
            <p>Welcome to the BMAD Platform! We're excited to have you on board.</p>
            <p>BMAD (Business Methodology for AI Development) helps you streamline your project planning with AI-powered insights and automated documentation generation.</p>
            
            <h3>Getting started:</h3>
            <div class="feature">1. Complete your profile setup</div>
            <div class="feature">2. Create your first planning session</div>
            <div class="feature">3. Explore our AI-powered project analysis tools</div>
            
            <p>If you have any questions, don't hesitate to reach out to our support team.</p>
        </div>
        <div class="footer">
            <p>Best regards,<br>The BMAD Team</p>
        </div>
    </div>
</body>
</html>
`;

  await sendEmail({
    to: email,
    subject,
    text,
    html,
  });
};