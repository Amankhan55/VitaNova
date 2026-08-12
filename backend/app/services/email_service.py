"""Outbound mail.

One transport, two modes. With ``VITANOVA_SMTP_HOST`` set, messages go out over
SMTP. Without it, they are logged in full and kept in :data:`outbox` — so local
development needs no mail account, and the tests can read the link that was
"sent" instead of reaching for a mail server.
"""

import logging
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formataddr, parseaddr

import aiosmtplib

from app.core.config import settings

logger = logging.getLogger(__name__)

# Bounded: a long-running dev server would otherwise accumulate every message it
# ever pretended to send.
_OUTBOX_LIMIT = 50


@dataclass(frozen=True)
class SentEmail:
    to: str
    subject: str
    text: str


outbox: list[SentEmail] = []


async def send(to: str, subject: str, text: str, html: str) -> None:
    """Deliver one message. Never raises — a mail failure must not turn into a
    500 that tells the caller whether an address is registered."""
    if not settings.smtp_host:
        outbox.append(SentEmail(to=to, subject=subject, text=text))
        del outbox[:-_OUTBOX_LIMIT]
        logger.info("[mail:not-sent] to=%s subject=%s\n%s", to, subject, text)
        return

    message = EmailMessage()
    message["From"] = _from_header()
    message["To"] = to
    message["Subject"] = subject
    message.set_content(text)
    message.add_alternative(html, subtype="html")

    try:
        await aiosmtplib.send(
            message,
            hostname=settings.smtp_host,
            port=settings.smtp_port,
            username=settings.smtp_user or None,
            password=settings.smtp_password or None,
            start_tls=settings.smtp_starttls,
            use_tls=not settings.smtp_starttls,
        )
    except (aiosmtplib.SMTPException, OSError):
        logger.exception("Failed to send %r to %s", subject, to)


def _from_header() -> str:
    name, address = parseaddr(settings.smtp_from)
    # Fall back to the authenticating account: providers like Gmail reject a
    # From that is not the mailbox you logged in as.
    return formataddr((name, address or settings.smtp_user))


# --------------------------------------------------------------------- bodies

_STYLE = (
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;"
    "font-size:15px;line-height:1.6;color:#14202f"
)
_BUTTON = (
    "display:inline-block;padding:11px 22px;border-radius:8px;"
    "background:#0d9488;color:#fff;font-weight:600;text-decoration:none"
)


def _layout(heading: str, body: str, action: str, link: str, footer: str) -> str:
    return f"""\
<div style="{_STYLE};max-width:520px;margin:0 auto;padding:32px 24px">
  <p style="font-size:19px;font-weight:700;margin:0 0 24px">Vita<span style="color:#0d9488">Nova</span></p>
  <h1 style="font-size:21px;margin:0 0 12px">{heading}</h1>
  <p style="margin:0 0 24px">{body}</p>
  <p style="margin:0 0 24px"><a href="{link}" style="{_BUTTON}">{action}</a></p>
  <p style="margin:0 0 8px;color:#5b6b7f;font-size:13px">
    Or paste this into your browser:<br /><a href="{link}" style="color:#0d9488">{link}</a>
  </p>
  <p style="margin:24px 0 0;color:#5b6b7f;font-size:13px">{footer}</p>
</div>"""


async def send_verification(to: str, name: str, link: str, ttl_hours: int) -> None:
    greeting = f"Hi {name}," if name else "Hi,"
    expiry = f"The link expires in {ttl_hours} hours."
    await send(
        to=to,
        subject="Confirm your VitaNova email",
        text=(
            f"{greeting}\n\nConfirm your email address to finish setting up your "
            f"VitaNova account:\n\n{link}\n\n{expiry}\n\n"
            "If you did not create an account, you can ignore this message."
        ),
        html=_layout(
            heading="Confirm your email",
            body=f"{greeting} confirm your address to finish setting up your VitaNova account.",
            action="Confirm email",
            link=link,
            footer=f"{expiry} If you did not create an account, you can ignore this message.",
        ),
    )


async def send_password_reset(to: str, name: str, link: str, ttl_minutes: int) -> None:
    greeting = f"Hi {name}," if name else "Hi,"
    expiry = f"The link expires in {ttl_minutes} minutes and can be used once."
    await send(
        to=to,
        subject="Reset your VitaNova password",
        text=(
            f"{greeting}\n\nUse this link to choose a new VitaNova password:\n\n"
            f"{link}\n\n{expiry}\n\n"
            "If you did not ask for a reset, ignore this message — your password "
            "has not changed."
        ),
        html=_layout(
            heading="Reset your password",
            body=f"{greeting} use the button below to choose a new VitaNova password.",
            action="Choose a new password",
            link=link,
            footer=(
                f"{expiry} If you did not ask for a reset, ignore this message — "
                "your password has not changed."
            ),
        ),
    )
