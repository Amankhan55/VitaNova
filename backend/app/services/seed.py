"""Starter and demo resume content.

``demo_resume_data`` reproduces the content of the reference PDFs, which makes it
the fixture for template gallery thumbnails and for the visual-regression check
against those references.
"""

from app.models.resume import (
    Basics,
    CertificationItem,
    CertificationsSection,
    EducationItem,
    EducationSection,
    ExperienceItem,
    ExperienceSection,
    LanguageItem,
    LanguagesSection,
    Link,
    ProjectItem,
    ProjectsSection,
    ResumeData,
    SkillGroupItem,
    SkillsSection,
    SummarySection,
)


def demo_resume_data() -> ResumeData:
    return ResumeData(
        basics=Basics(
            full_name="Alex Morgan",
            headline="Senior Software & UI Developer",
            email="a.morgan@techmail.com",
            phone="+1 (555) 382-9104",
            location="San Francisco, CA",
            links=[
                Link(label="linkedin.com/in/alex-morgan-dev",
                     url="https://linkedin.com/in/alex-morgan-dev", icon="linkedin"),
                Link(label="github.com/alexmorgan-ui",
                     url="https://github.com/alexmorgan-ui", icon="github"),
            ],
        ),
        sections=[
            SummarySection(
                title="Professional Summary",
                content=(
                    "Results-driven Senior Software & UI Developer with over 7 years of "
                    "experience building high-performance web applications and enterprise "
                    "design systems. Specialized in TypeScript, React, and modern frontend "
                    "architectures. Proven track record of accelerating delivery cycles by "
                    "35% and improving Web Vitals scores for high-traffic SaaS platforms "
                    "serving over 2M active monthly users."
                ),
            ),
            ExperienceSection(
                title="Professional Experience",
                items=[
                    ExperienceItem(
                        role="Lead UI Developer",
                        organization="Nexus Cloud Solutions",
                        location="San Francisco, CA",
                        start="2022",
                        end="",
                        current=True,
                        bullets=[
                            "Spearheaded redesign of flagship enterprise analytics dashboard "
                            "using React 18, TypeScript, and Tailwind CSS, increasing user "
                            "engagement by 28%.",
                            "Architected accessibility-first component library adoption across "
                            "5 product teams, achieving full WCAG 2.1 AA compliance.",
                            "Mentored team of 6 frontend engineers, establishing rigorous code "
                            "review practices and automated UI testing protocols via Jest and "
                            "Cypress.",
                        ],
                    ),
                    ExperienceItem(
                        role="Senior Frontend Engineer",
                        organization="Vanguard Media Tech",
                        location="San Jose, CA",
                        start="2019",
                        end="2022",
                        bullets=[
                            "Engineered high-throughput streaming video web client handling "
                            "over 500k concurrent WebSocket connections.",
                            "Reduced initial page load time from 3.8s to 1.2s through "
                            "route-based code splitting and image optimization pipelines.",
                            "Collaborated closely with Product and UX teams to design intuitive "
                            "data visualization components using D3.js and Chart.js.",
                        ],
                    ),
                    ExperienceItem(
                        role="Software Engineer (Frontend)",
                        organization="Apex Digital Interactive",
                        location="Austin, TX",
                        start="2017",
                        end="2019",
                        bullets=[
                            "Developed responsive e-commerce web applications utilizing React, "
                            "Redux, and RESTful microservices.",
                            "Integrated payment gateway solutions (Stripe, PayPal) resulting in "
                            "seamless checkout UX and a 12% increase in conversion.",
                        ],
                    ),
                ],
            ),
            ProjectsSection(
                title="Key Projects",
                items=[
                    ProjectItem(
                        name="Pulse Design System",
                        period="2023",
                        tech=["React", "TypeScript", "Storybook", "Tailwind CSS"],
                        bullets=[
                            "Created open-source UI system containing 45+ accessible "
                            "components, decreasing feature time-to-market by 40%.",
                        ],
                    ),
                    ProjectItem(
                        name="Real-Time Data Viz Suite",
                        period="2021",
                        tech=["Next.js", "GraphQL", "Canvas API", "WebSockets"],
                        bullets=[
                            "Built financial telemetry module capable of rendering 10,000 live "
                            "data points at 60 FPS.",
                        ],
                    ),
                ],
            ),
            SkillsSection(
                title="Skills",
                items=[
                    SkillGroupItem(
                        label="Frontend Architecture",
                        keywords=["React", "Next.js", "TypeScript", "Vue.js",
                                  "HTML5/CSS3", "Tailwind CSS", "Webpack"],
                    ),
                    SkillGroupItem(
                        label="State & Performance",
                        keywords=["Redux Toolkit", "Zustand", "GraphQL", "REST APIs",
                                  "Web Vitals Optimization"],
                    ),
                    SkillGroupItem(
                        label="UI/UX & Systems",
                        keywords=["Figma", "Design Systems", "Storybook",
                                  "Accessibility (WCAG 2.1 AA)"],
                    ),
                    SkillGroupItem(
                        label="Testing & Tooling",
                        keywords=["Jest", "React Testing Library", "Cypress", "Git",
                                  "CI/CD Pipelines"],
                    ),
                ],
            ),
            EducationSection(
                title="Education",
                items=[
                    EducationItem(
                        degree="B.S. in Computer Science",
                        institution="University of California, Berkeley",
                        location="Berkeley, CA",
                        start="2013",
                        end="2017",
                    )
                ],
            ),
            CertificationsSection(
                title="Certifications",
                items=[
                    CertificationItem(name="AWS Certified Developer",
                                      issuer="Associate", date="2024"),
                    CertificationItem(name="Meta Front-End Developer",
                                      issuer="Professional Certificate", date="2022"),
                ],
            ),
            LanguagesSection(
                title="Languages",
                items=[
                    LanguageItem(name="English", level="Native / Full Professional"),
                    LanguageItem(name="Spanish", level="Professional Working"),
                ],
            ),
        ],
    )


def starter_resume_data(full_name: str = "", email: str = "") -> ResumeData:
    """An empty scaffold for a brand-new resume: the right sections, no content."""
    return ResumeData(
        basics=Basics(full_name=full_name, email=email),
        sections=[
            SummarySection(),
            ExperienceSection(items=[ExperienceItem()]),
            EducationSection(items=[EducationItem()]),
            SkillsSection(items=[SkillGroupItem()]),
            ProjectsSection(items=[]),
            CertificationsSection(items=[]),
            LanguagesSection(items=[]),
        ],
    )
