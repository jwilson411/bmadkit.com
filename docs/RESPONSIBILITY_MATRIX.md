# BMAD Web UI Platform - Responsibility Matrix

**Document Version:** 1.0  
**Created:** 2025-09-08  
**Author:** Sarah (Product Owner)  
**Purpose:** Define clear ownership and accountability for all project tasks and ongoing operations

---

## Overview

This matrix defines **who is responsible for what** in the BMAD Web UI Platform project to prevent confusion, delays, and ownership disputes. Tasks are categorized by **Human-Only** (requires human judgment/access), **Agent-Preferred** (can be automated), and **Collaborative** (requires both).

---

## Responsibility Categories

- 🧑 **USER ONLY** - Tasks requiring human judgment, access, or decision-making
- 🤖 **AGENT PREFERRED** - Tasks that can/should be automated or AI-assisted
- 🤝 **COLLABORATIVE** - Tasks requiring both human oversight and agent execution

---

## 1. PROJECT SETUP & INITIALIZATION

| Task | Owner | Type | Details | Handoff Procedure |
|------|-------|------|---------|-------------------|
| **External Account Creation** | User | 🧑 | OpenAI, Anthropic, Stripe, Railway accounts require human verification | User provides API keys to Senior Developer |
| **Domain Registration & DNS** | User | 🧑 | Business decision on domain name, requires payment authorization | User provides domain details to DevOps |
| **Repository Creation & Access** | User | 🧑 | GitHub repository creation, team access permissions | User adds agents as collaborators |
| **Monorepo Structure Setup** | Senior Developer | 🤖 | Automated scaffolding based on architecture specification | None - fully automated |
| **Development Environment Docs** | Senior Developer | 🤖 | Step-by-step setup documentation generation | User validates setup works |
| **CI/CD Pipeline Configuration** | Senior Developer | 🤖 | GitHub Actions automation based on defined workflows | User approves deployment permissions |

---

## 2. INFRASTRUCTURE & DEPLOYMENT

| Task | Owner | Type | Details | Handoff Procedure |
|------|-------|------|---------|-------------------|
| **Cloud Service Provisioning** | User | 🧑 | Railway/AWS account setup, payment method configuration | User provides access credentials securely |
| **Database Service Creation** | Senior Developer | 🤖 | PostgreSQL instance provisioning via infrastructure code | User approves resource costs |
| **Redis Cache Setup** | Senior Developer | 🤖 | Redis Cloud or Railway Redis configuration | None - automated deployment |
| **SSL Certificate Management** | Senior Developer | 🤖 | Automated certificate provisioning and renewal | None - fully automated |
| **Environment Configuration** | Senior Developer | 🤖 | Development, staging, production environment setup | User reviews and approves configurations |
| **Backup & Recovery Setup** | Senior Developer | 🤖 | Automated backup configuration for data protection | User defines backup retention policies |

---

## 3. EXTERNAL SERVICE INTEGRATION

| Task | Owner | Type | Details | Handoff Procedure |
|------|-------|------|---------|-------------------|
| **OpenAI API Account & Billing** | User | 🧑 | Account creation, payment method, usage limits | User securely provides API key to Senior Developer |
| **Anthropic API Account & Billing** | User | 🧑 | Account creation, payment method, usage limits | User securely provides API key to Senior Developer |
| **Stripe Account & Verification** | User | 🧑 | Business verification, tax information, bank account | User provides webhook endpoints and keys securely |
| **Email Service Setup** | User | 🧑 | Business email account, sender verification | User provides SMTP credentials to Senior Developer |
| **API Integration Implementation** | Senior Developer | 🤖 | Code implementation of all external API calls | None - based on provided credentials |
| **Webhook Configuration** | Senior Developer | 🤖 | Automated webhook endpoint setup and security | User approves webhook URLs and security |

---

## 4. DEVELOPMENT & CODE MANAGEMENT

| Task | Owner | Type | Details | Handoff Procedure |
|------|-------|------|---------|-------------------|
| **Story Creation & Prioritization** | Product Owner | 🤖 | Break down epics into actionable development stories | Hands off to Senior Developer for implementation |
| **Code Implementation** | Senior Developer | 🤖 | All application code, APIs, database schemas | Code review by Senior Developer before merge |
| **Architecture Documentation** | Software Architect | 🤖 | Technical architecture and design decisions | Review with Product Owner for business alignment |
| **UI/UX Implementation** | Junior Developer | 🤝 | Frontend components based on UX Expert specifications | Senior Developer reviews for standards compliance |
| **Database Migrations** | Senior Developer | 🤖 | Schema changes and data migration scripts | User approval required for production migrations |
| **Security Implementation** | Senior Developer | 🤖 | Authentication, authorization, data protection | Security review by external auditor (user arranged) |

---

## 5. TESTING & QUALITY ASSURANCE

| Task | Owner | Type | Details | Handoff Procedure |
|------|-------|------|---------|-------------------|
| **Test Strategy Definition** | QA (Quinn) | 🤖 | Comprehensive testing approach and standards | Reviewed with Product Owner for completeness |
| **Unit Test Implementation** | Senior Developer | 🤖 | Automated unit tests for all code components | QA validates test coverage meets requirements |
| **Integration Testing** | QA (Quinn) | 🤖 | End-to-end testing of system functionality | Reports sent to Product Owner and Senior Developer |
| **Load Testing** | QA (Quinn) | 🤖 | Performance testing for 1K concurrent users | User defines acceptable performance thresholds |
| **Security Testing** | QA (Quinn) | 🤝 | Automated security scanning + manual review | User arranges external security audit if needed |
| **User Acceptance Testing** | User | 🧑 | Business validation of implemented features | User provides formal acceptance or change requests |

---

## 6. UI/UX & DESIGN

| Task | Owner | Type | Details | Handoff Procedure |
|------|-------|------|---------|-------------------|
| **Design System Creation** | UX Expert | 🤖 | Comprehensive UI component and pattern library | Senior Developer implements as reusable components |
| **User Flow Definition** | UX Expert | 🤖 | Detailed user journey mapping and optimization | Product Owner validates against business requirements |
| **Visual Design Assets** | User | 🧑 | Logo, brand colors, imagery, icon selection | User provides assets to UX Expert for implementation |
| **Accessibility Compliance** | UX Expert | 🤖 | WCAG AA compliance implementation and testing | QA validates accessibility requirements are met |
| **Mobile Optimization** | Junior Developer | 🤝 | Responsive design implementation | UX Expert reviews against design specifications |
| **Design Tool Management** | User | 🧑 | Figma/design tool account and collaboration setup | User grants access to UX Expert and developers |

---

## 7. OPERATIONS & MAINTENANCE

| Task | Owner | Type | Details | Handoff Procedure |
|------|-------|------|---------|-------------------|
| **Monitoring & Alerting Setup** | Senior Developer | 🤖 | Comprehensive system monitoring and alert rules | User defines escalation procedures and contacts |
| **Log Management** | Senior Developer | 🤖 | Centralized logging and analysis system | None - automated operation |
| **Performance Monitoring** | Senior Developer | 🤖 | Application and infrastructure performance tracking | User reviews performance reports and sets SLAs |
| **Incident Response** | Senior Developer | 🤝 | First-level incident response and troubleshooting | User escalates to external support if needed |
| **Backup Verification** | Senior Developer | 🤖 | Automated backup testing and recovery validation | User defines recovery time objectives |
| **Security Updates** | Senior Developer | 🤖 | Regular security patching and vulnerability remediation | User approves maintenance windows |

---

## 8. BUSINESS & COMPLIANCE

| Task | Owner | Type | Details | Handoff Procedure |
|------|-------|------|---------|-------------------|
| **Privacy Policy & Terms** | User | 🧑 | Legal documentation for user data and service terms | User provides to UX Expert for integration |
| **GDPR/Privacy Compliance** | User | 🤝 | Legal compliance strategy and implementation | Senior Developer implements technical controls |
| **Business Intelligence Setup** | User | 🧑 | Analytics tools, KPI definition, reporting requirements | Senior Developer implements tracking |
| **Customer Support Setup** | User | 🧑 | Support channels, documentation, escalation procedures | UX Expert creates user-facing help documentation |
| **Billing & Revenue Tracking** | User | 🧑 | Financial reporting, revenue recognition, tax compliance | Stripe integration provides automated data |
| **Marketing & SEO** | User | 🧑 | Content creation, SEO optimization, marketing campaigns | UX Expert optimizes landing pages for conversion |

---

## 9. COMMUNICATION & HANDOFF PROCEDURES

### Secure Credential Handoff
**When User provides sensitive information to Agents:**

1. **API Keys/Credentials:** Use secure password manager or encrypted communication
2. **Financial Information:** Never share directly - use secure business channels
3. **Access Permissions:** Provide minimum required permissions, revokable
4. **Documentation:** Agent documents what credentials are needed and why

### Agent-to-Agent Handoff
**When one Agent hands work to another:**

1. **Completion Verification:** Previous agent confirms work is complete and tested
2. **Documentation Update:** All relevant documentation updated before handoff
3. **Context Transfer:** Next agent receives full context and requirements
4. **Quality Gates:** QA validation before moving to next development phase

### User Approval Requirements
**Tasks requiring explicit User approval:**

- Production deployments
- External service account creation
- Financial commitments or billing changes
- Data migration or schema changes in production
- Security policy modifications
- Third-party integrations with data access

---

## 10. EMERGENCY & ESCALATION PROCEDURES

### Production Issues
1. **Senior Developer** - First responder for technical issues
2. **User** - Business decision maker for service interruptions
3. **QA (Quinn)** - Quality assessment and validation post-resolution

### Security Incidents
1. **Senior Developer** - Immediate technical response and containment
2. **User** - External security consultant engagement if needed
3. **Legal/Compliance** - User responsibility for breach notifications

### Scope Changes
1. **Product Owner** - Requirements and story modification authority
2. **Software Architect** - Technical feasibility and impact assessment
3. **User** - Final approval for timeline and resource changes

---

## Success Metrics

**Responsibility Matrix is successful when:**

✅ **Zero task ownership confusion** - Every team member knows their responsibilities  
✅ **No blocking dependencies** - Clear handoff procedures prevent delays  
✅ **Appropriate skill allocation** - Right person/agent for each task type  
✅ **Accountability tracking** - Clear ownership for deliverables and outcomes  
✅ **Efficient escalation** - Issues reach the right decision maker quickly  

---

## Document Maintenance

**This responsibility matrix should be updated when:**
- New team members or agents are added
- Project scope changes significantly
- New external services are integrated
- Operational procedures change
- Lessons learned from task confusion or delays

**Update Authority:** Product Owner (Sarah) in collaboration with User

---

**Document Status:** Active  
**Next Review:** 2025-09-15  
**Distribution:** All project team members and agents