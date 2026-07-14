# Project Savannah Design System

**Document:** Project Savannah Design Specification  
**Abbreviation:** PSDS  
**Version:** 1.0  
**Project release:** Project Savannah v1.3  
**Status:** Canonical frontend reference  
**Last updated:** July 2026  

---

## 1. Purpose

The Project Savannah Design System defines the visual language, reusable interface patterns, accessibility requirements, interaction standards, and frontend implementation rules for Project Savannah.

This document is the canonical reference for all current and future frontend development.

All pages, components, layouts, and workflows must follow this specification unless an approved design decision updates the standard.

The design system exists to ensure that Project Savannah remains:

- Consistent
- Accessible
- Maintainable
- Scalable
- Responsive
- Easy to understand
- Efficient to use
- Suitable for production

---

## 2. Product Experience

Project Savannah should feel like a professional software product rather than a collection of Google Apps Script pages.

The interface should feel:

- Clean
- Calm
- Modern
- Focused
- Fast
- Dependable
- Information-rich without feeling crowded

The application should prioritise user workflows and automation over decorative complexity.

---

## 3. Design Principles

### 3.1 Automation first

The interface should remove work from the user.

Actions that can be safely automated should not require repeated manual steps.

Examples include:

- Generating ideas
- Generating scripts
- Creating SEO content
- Moving approved content through the pipeline
- Displaying system health
- Reporting errors and costs

---

### 3.2 One obvious primary action

Every page should have one clearly identifiable primary action.

Examples:

- Dashboard: Generate Ideas
- Ideas: Generate Ideas
- Scripts: Generate Script
- SEO: Generate SEO
- Approval Queue: Approve Selected
- Settings: Save Settings

Secondary actions must not visually compete with the primary action.

---

### 3.3 Consistency over novelty

Components should behave and appear consistently throughout the application.

A button, badge, modal, table, card, or notification must not be redesigned independently for one page.

Shared components must be reused.

---

### 3.4 Important information stays visible

Critical information should be available without unnecessary navigation.

Examples include:

- Queue totals
- Failed operations
- API status
- Current cost
- Approval status
- Active generation progress

---

### 3.5 Minimise context switching

Related information and actions should remain together.

For example, a script editor should display the script, status, metadata, duration, and relevant actions without requiring the user to visit several pages.

---

### 3.6 Preserve user work

User input must not disappear because of:

- Refreshing
- Loading
- Navigation
- Failed AI generation
- Network errors
- Validation errors

Where practical, unsaved changes should be detected and protected.

---

### 3.7 Explain system state

The interface must clearly communicate whether an operation is:

- Idle
- Loading
- Processing
- Successful
- Failed
- Waiting for approval
- Disabled
- Unavailable

The user should never have to guess whether an action worked.

---

## 4. Frontend Architecture

The frontend is organised under the following structure:

```text
Frontend/
├── Assets/
│   ├── Icons/
│   ├── Images/
│   ├── Scripts/
│   └── Styles/
│
├── Components/
│   ├── Layout/
│   ├── Navigation/
│   └── UI/
│
├── Views/
└── Index.html